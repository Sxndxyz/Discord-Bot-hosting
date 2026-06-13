require('dotenv').config();
const fs = require('fs');
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, Events, PermissionsBitField, EmbedBuilder, ChannelType, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, MessageFlags } = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const QUEUE_FILE = './Q.json';
const TICKET_COUNT_FILE = './ticket_count.json';
const TICKET_CATEGORY_ID = ""; // หมวดหมู่ที่จะส่ง ตั๋ว
const SUPPORT_ROLE_ID = ""; // ยศแอดมิน
const LOG_CHANNEL_ID = ""; // log ปิดห้อง

function getNextTicketNumber() {
    if (!fs.existsSync(TICKET_COUNT_FILE)) {
        fs.writeFileSync(TICKET_COUNT_FILE, JSON.stringify({ count: 0 }, null, 2));
    }
    const data = JSON.parse(fs.readFileSync(TICKET_COUNT_FILE, 'utf8'));
    data.count += 1;
    fs.writeFileSync(TICKET_COUNT_FILE, JSON.stringify(data, null, 2));
    return String(data.count).padStart(3, "0");
}

function loadQueue() {
    if (!fs.existsSync(QUEUE_FILE)) {
        return { queueCount: 0, users: {} };
    }
    return JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
}

function saveQueue(data) {
    fs.writeFileSync(QUEUE_FILE, JSON.stringify(data, null, 4), 'utf8');
}

client.once(Events.ClientReady, async readyClient => {
    console.log(`\x1b[32mLOGGED IN AS ${readyClient.user.tag}\x1b[0m`);
    console.log(`\x1b[34mSUCCESSFULLY!\x1b[0m 彡 INFO :[ BY: \x1b[31mHYDRA\x1b[0m, \x1b[0m STATUS: \x1b[32mLOGIN BOT\x1b[0m, WORKING: \x1b[35mOKAY READY LET'S GO!\x1b[0m ]`);

    try {
        await readyClient.application.commands.create({
            name: 'setup-ticket',
            description: 'สร้างหน้าเปิดตั๋วทิกเก็ต (เฉพาะแอดมิน)',
            defaultMemberPermissions: PermissionsBitField.Flags.Administrator
        });
    } catch (err) {
        console.error('Failed to register slash command:', err);
    }
});

client.on(Events.MessageCreate, async message => {
    if (message.author.bot) return;

    const command = message.content.trim().split(/ +/)[0];
    if (command === '!ดูคำสั่งทั้งหมด') {
        if (!message.member || !message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('\`\`❌\`\` ขออภัย คำสั่งนี้ใช้ได้เฉพาะแอดมินเท่านั้นครับ');
        }

        const helpEmbed = new EmbedBuilder()
            .setColor('#3498db')
            .setTitle('\`\`📚\`\` คำสั่งทั้งหมดของบอทระบบคิว & ทิกเก็ต')
            .addFields(
                { name: '\`\`🛠️\`\` สำหรับแอดมิน', value: '`/setup-queue` - สร้างป้ายเมนูสำหรับให้ลูกค้ากดรับคิว\n`!ล้างคิว` - รีเซ็ตคิวทั้งหมดกลับเป็น 0 \`(ล้างข้อมูลคนกดเก่า)\`\n`/setup-ticket` - สร้างหน้าเปิดตั๋วทิกเก็ต' },
                { name: '\`\`👤\`\` สำหรับลูกค้าทั่วไป', value: 'ลูกค้าสามารถกดปุ่ม **"ลงคิว"** จากป้ายเมนูที่แอดมินสร้างขึ้นได้เลยครับ' }
            )
            .setImage('https://cdn.discordapp.com/attachments/1507302074231291914/1514541869814648832/embed_tumblr_042c553cb2306d437886179a502240d9_c2f6f59d_640.gif?ex=6a2d1008&is=6a2bbe88&hm=0d8067faf4ac016e9a8077e367adba21423a298d4ce2545d1f306e49c4d4bf76')
            .setTimestamp();

        message.delete().catch(() => {});
        return message.channel.send({ embeds: [helpEmbed] });
    }

    if (command === '!ล้างคิว') {
        if (!message.member || !message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('`❌` ขออภัย คำสั่งนี้ใช้ได้เฉพาะแอดมินเท่านั้นครับ');
        }

        const queueData = { queueCount: 0, users: {} };
        saveQueue(queueData);

        message.delete().catch(() => {});
        const clearEmbed = new EmbedBuilder()
            .setColor('#2ecc71')
            .setDescription('> # \`✅\` ทำการล้างคิวเรียบร้อยแล้ว!');
        return message.channel.send({ embeds: [clearEmbed] });
    }

    if (command === '!คิว') {
        if (!message.member || !message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('\`\`❌\`\` ขออภัย คำสั่งนี้ใช้ได้เฉพาะแอดมินเท่านั้นครับ');
        }
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('join_queue')
                    .setLabel('ลงคิว')
                    .setStyle(ButtonStyle.Success),
            );

        const queueEmbed = new EmbedBuilder()
            .setColor('#2ecc71')
            .setTitle('\`\`📝\`\` ระบบรับคิวอัตโนมัติ')
            .setDescription('กรุณากดปุ่ม **"ลงคิว"** ด้านล่างเพื่อทำการรับคิว\n\n> \`⏳\` รอการดำเนินการไม่เกิน 30 นาที')
            .addFields(
                { name: '\`🧾\` การทำรายการ', value: 'แอดมินจะเริ่มทำรายการตามลำดับคิวของลูกค้านะครับ' }
            )
            .setImage('https://cdn.discordapp.com/attachments/1507302074231291914/1514541869814648832/embed_tumblr_042c553cb2306d437886179a502240d9_c2f6f59d_640.gif?ex=6a2d1008&is=6a2bbe88&hm=0d8067faf4ac016e9a8077e367adba21423a298d4ce2545d1f306e49c4d4bf76')
            .setTimestamp();

        message.delete().catch(() => {});
        await message.channel.send({
            embeds: [queueEmbed],
            components: [row]
        });
    }
});

client.on(Events.InteractionCreate, async interaction => {
    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'setup-ticket') {
            const ticketEmbed = new EmbedBuilder()
                .setColor('#2b2d31')
                .setDescription(
                    `# \`\`🎫\`\` Ticket\n` +
                    `## หากพบปัญหาการใช้งาน หรือต้องการสอบถามเพิ่มเติม\nกรุณากดเลือกเมนูด้านล่างเพื่อเปิดตั๋วติดต่อทีมงานครับ\n\n` +
                    `> \`\`🛒\`\` **เปิดตั๋วแล้วสามารถส่งข้อมูลไว้ในห้องได้เลยครับ**\n\n`
                )
                .setImage("https://cdn.discordapp.com/attachments/1429776211437158471/1449227012139909170/Hydra_copy.png?ex=69529095&is=69513f15&hm=86d70e924f40e135cd9e7ea0d739b24fc28b3c1c465277490a5f2dfee510b171&"); // เปลื่ยนรูปตรงนี้

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId("ticket_menu")
                .setPlaceholder(" 𝐎𝐏𝐄𝐍 𝐓𝐈𝐂𝐊𝐄𝐓 ")
                .addOptions(
                    new StringSelectMenuOptionBuilder()
                        .setLabel("ติดต่องาน")
                        .setDescription("𝐈𝐧𝐪𝐮𝐢𝐫𝐞 𝐚𝐧𝐝 𝐨𝐫𝐝𝐞𝐫 𝐰𝐨𝐫𝐤")
                        .setEmoji("🎫")
                        .setValue("create_ticket"),
                    new StringSelectMenuOptionBuilder()
                        .setLabel("แจ้งปัญหาการใช้งาน")
                        .setDescription("𝐑𝐞𝐩𝐨𝐫𝐭 𝐚𝐧 𝐢𝐬𝐬𝐮𝐞")
                        .setEmoji("⚠️")
                        .setValue("report_issue"),
                    new StringSelectMenuOptionBuilder()
                        .setLabel("ล้างตัวเลือก")
                        .setDescription("𝐑𝐞𝐬𝐞𝐭 𝐬𝐞𝐥𝐞𝐜𝐭𝐢𝐨𝐧")
                        .setEmoji("🔄")
                        .setValue("reset_ui")
                );

            const selectRow = new ActionRowBuilder().addComponents(selectMenu);

            await interaction.channel.send({ embeds: [ticketEmbed], components: [selectRow] });
            const successSetupEmbed = new EmbedBuilder()
                .setColor('#2ecc71')
                .setDescription('> # \`✅\` สร้างหน้าต่างตั๋วสำเร็จ!');
            await interaction.reply({ embeds: [successSetupEmbed], flags: MessageFlags.Ephemeral });
            return;
        }
    }

    if (interaction.isStringSelectMenu() && interaction.customId === "ticket_menu") {
        const value = interaction.values[0];

        if (value === "reset_ui") {
            const resetMenu = new StringSelectMenuBuilder()
                .setCustomId("ticket_menu")
                .setPlaceholder(" 𝐎𝐏𝐄𝐍 𝐓𝐈𝐂𝐊𝐄𝐓 ")
                .addOptions(
                    new StringSelectMenuOptionBuilder()
                        .setLabel("ติดต่องาน")
                        .setDescription("𝐈𝐧𝐪𝐮𝐢𝐫𝐞 𝐚𝐧𝐝 𝐨𝐫𝐝𝐞𝐫 𝐰𝐨𝐫𝐤")
                        .setEmoji("🎫")
                        .setValue("create_ticket"),
                    new StringSelectMenuOptionBuilder()
                        .setLabel("แจ้งปัญหาการใช้งาน")
                        .setDescription("𝐑𝐞𝐩𝐨𝐫𝐭 𝐚𝐧 𝐢𝐬𝐬𝐮𝐞")
                        .setEmoji("⚠️")
                        .setValue("report_issue"),
                    new StringSelectMenuOptionBuilder()
                        .setLabel("ล้างตัวเลือก")
                        .setDescription("𝐑𝐞𝐬𝐞𝐭 𝐬𝐞𝐥𝐞𝐜𝐭𝐢𝐨𝐧")
                        .setEmoji("🔄")
                        .setValue("reset_ui")
                );
            await interaction.update({ components: [new ActionRowBuilder().addComponents(resetMenu)] }).catch(() => {});
            return;
        }

        if (!["create_ticket", "report_issue"].includes(value)) return;

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId("ticket_menu")
            .setPlaceholder(" 𝐎𝐏𝐄𝐍 𝐓𝐈𝐂𝐊𝐄𝐓 ")
            .addOptions(
                new StringSelectMenuOptionBuilder()
                    .setLabel("ติดต่องาน")
                    .setDescription("𝐈𝐧𝐪𝐮𝐢𝐫𝐞 𝐚𝐧𝐝 𝐨𝐫𝐝𝐞𝐫 𝐰𝐨𝐫𝐤")
                    .setEmoji("🎫")
                    .setValue("create_ticket"),
                new StringSelectMenuOptionBuilder()
                    .setLabel("แจ้งปัญหาการใช้งาน")
                    .setDescription("𝐑𝐞𝐩𝐨𝐫𝐭 𝐚𝐧 𝐢𝐬𝐬𝐮𝐞")
                    .setEmoji("⚠️")
                    .setValue("report_issue"),
                new StringSelectMenuOptionBuilder()
                    .setLabel("ล้างตัวเลือก")
                    .setDescription("𝐑𝐞𝐬𝐞𝐭 𝐬𝐞𝐥𝐞𝐜𝐭𝐢𝐨𝐧")
                    .setEmoji("🔄")
                    .setValue("reset_ui")
            );
        await interaction.message.edit({ components: [new ActionRowBuilder().addComponents(selectMenu)] }).catch(() => {});

        try {
            const ticketNumber = getNextTicketNumber();

            const channel = await interaction.guild.channels.create({
                name: `ticket-${interaction.user.username}-${ticketNumber}`,
                type: ChannelType.GuildText,
                topic: interaction.user.id,
                parent: TICKET_CATEGORY_ID,
                permissionOverwrites: [
                    { id: interaction.guild.id, type: 0, deny: [PermissionsBitField.Flags.ViewChannel] },
                    { 
                        id: interaction.user.id, 
                        type: 1,
                        allow: [ PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.AttachFiles, PermissionsBitField.Flags.EmbedLinks ] 
                    },
                    { 
                        id: SUPPORT_ROLE_ID, 
                        type: 0,
                        allow: [ PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory ] 
                    },
                ],
            });

            const welcomeEmbed = new EmbedBuilder()
                .setColor('#2b2d31')
                .setDescription(
                    `# \`🎫\` Ticket #${ticketNumber}\n` +
                    `ผู้เปิดตั๋ว: ${interaction.user}\n\n` +
                    `กรุณาพิมพ์รายละเอียดที่ต้องการให้ทีมงานช่วยเหลือครับ`
                );

            const closeRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId("close_ticket")
                    .setLabel("ปิดตั๋ว")
                    .setEmoji("🔒")
                    .setStyle(ButtonStyle.Danger)
            );

            await channel.send({ content: `${interaction.user}`, embeds: [welcomeEmbed], components: [closeRow] });
            const successTicketEmbed = new EmbedBuilder()
                .setColor('#2ecc71')
                .setDescription(`> # \`✅\` สร้างตั๋วเรียบร้อย\n> <#${channel.id}>`);
            await interaction.editReply({ embeds: [successTicketEmbed] });
        } catch (err) {
            console.error(err);
            const errorTicketEmbed = new EmbedBuilder()
                .setColor('#e74c3c')
                .setDescription(`> # \`❌\` เกิดข้อผิดพลาด\n> บอทไม่มีสิทธิ์สร้างห้อง หรือใส่ Category ID ไม่ถูกต้อง`);
            await interaction.editReply({ embeds: [errorTicketEmbed] });
        }
        return;
    }

    if (interaction.isButton() && interaction.customId === "close_ticket") {
        const hasRole = interaction.member.roles.cache.has(SUPPORT_ROLE_ID);
        if (!hasRole) {
            const noPermEmbed = new EmbedBuilder()
                .setColor('#e74c3c')
                .setDescription(`> # \`❌\` คุณไม่มีสิทธิ์ปิดตั๋วนี้`);
            return interaction.reply({ embeds: [noPermEmbed], flags: MessageFlags.Ephemeral });
        }

        const closingEmbed = new EmbedBuilder()
            .setColor('#e67e22')
            .setDescription(`> # \`🔒\` กำลังปิดตั๋ว...`);
        await interaction.reply({ embeds: [closingEmbed] });

        const parts = interaction.channel.name.split('-');
        const ticketId = parts[parts.length - 1];
        const openedById = interaction.channel.topic || "ไม่ทราบผู้เปิด";
        const openedByMention = openedById !== "ไม่ทราบผู้เปิด" ? `<@${openedById}>` : "ไม่ทราบผู้เปิด";

        const logChannel = interaction.guild.channels.cache.get(LOG_CHANNEL_ID);
        if (logChannel) {
            const logEmbed = new EmbedBuilder()
                .setColor('#2b2d31')
                .setTitle('Ticket Closed')
                .setDescription(`This ticket has been closed by ${interaction.user}`)
                .addFields(
                    { name: 'Ticket ID', value: ticketId, inline: false },
                    { name: 'Open Time', value: `<t:${Math.floor(interaction.channel.createdTimestamp / 1000)}:f>`, inline: false },
                    { name: 'Opened By', value: openedByMention, inline: false },
                    { name: 'Reason', value: '\`\`\`ไม่มีการระบุเหตุผล\`\`\`', inline: false }
                )
                .setTimestamp();
            logChannel.send({ embeds: [logEmbed] }).catch(() => {});
        }

        setTimeout(() => {
            interaction.channel.delete().catch(() => {});
        }, 5000);
        return;
    }

    if (!interaction.isButton()) return;

    if (interaction.customId === 'join_queue') {
        const queueData = loadQueue();
        const userId = interaction.user.id;

        if (queueData.users[userId]) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#e74c3c')
                .setDescription(`> ## \`❌\` คุณได้ลงคิวไปแล้วครับ\n> ### คิวของคุณคือ **คิวที่ ${queueData.users[userId]}**`);
            return await interaction.reply({
                embeds: [errorEmbed],
                flags: MessageFlags.Ephemeral
            });
        }

        queueData.queueCount++;
        const currentQueue = queueData.queueCount;
        queueData.users[userId] = currentQueue;
        saveQueue(queueData);
    
        const successEmbed = new EmbedBuilder()
            .setColor('#2ecc71')
            .setDescription(`> ## \`✅\` คุณได้รับคิวที่ ${currentQueue} ครับ กรุณารอสักครู่`);
    
        await interaction.reply({
            embeds: [successEmbed],
            flags: MessageFlags.Ephemeral
        });
        await interaction.message.delete().catch(() => {});

        const announceEmbed = new EmbedBuilder()
            .setColor('#f1c40f')
            .setDescription(`> ## \`📢\` <@${userId}> ได้รับคิวที่ ${currentQueue} แล้วครับ!`);

        await interaction.channel.send({ embeds: [announceEmbed] });
    }
});

client.login(process.env.DISCORD_TOKEN);
