require('dotenv').config();
const fs = require('fs');
const puppeteer = require('puppeteer');
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, Events, PermissionsBitField, EmbedBuilder, ChannelType, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds
    ]
});

const QUEUE_FILE = './Q.json';
const TICKET_COUNT_FILE = './ticket_count.json';
const TICKET_CATEGORY_ID = "1514259014744018974"; // หมวดหมู่ที่จะส่ง ตั๋ว
const SUPPORT_ROLE_IDS = ["1514258814201888778", "1514258793658323024", "1514258765166280744"]; // ยศแอดมิน
const LOG_CHANNEL_ID = "1515300436113100860"; // log ปิดห้อง
const PAYMENT_CHANNEL_ID = "1515691093470085150"; // ช่องส่งลิ้งค์ชำระเงิน
const RECEIVING_PHONE = process.env.RECEIVING_PHONE || "0962869917"; // เบอร์รับเงิน

async function scrapeTrueMoneyAmount(url) {
    let browser;
    try {
        browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
        await new Promise(r => setTimeout(r, 3000));

        await page.click('#voucher-detail-link').catch(() => {});
        await new Promise(r => setTimeout(r, 2000));

        const result = await page.evaluate(() => {
            const bodyText = document.body.innerText;

            let amount = null;
            const m1 = bodyText.match(/฿\s*[\d.]+\s*\/\s*([\d.]+)/);
            if (m1) amount = m1[1];
            else {
                const m2 = bodyText.match(/฿\s*([\d,]+(?:\.\d{2})?)/);
                if (m2) amount = m2[1].replace(/,/g, '');
            }

            let claimed = false;
            const claimMatch = bodyText.match(/฿\s*([\d.]+)\s*\/\s*([\d.]+)/);
            if (claimMatch) {
                const received = parseFloat(claimMatch[1]);
                const total = parseFloat(claimMatch[2]);
                claimed = received === total && total > 0;
            }

            return { amount, claimed, bodyText: bodyText.substring(0, 500) };
        });

        console.log(`[Check] amount=${result.amount || 'null'}, claimed=${result.claimed} from ${url}`);
        console.log(`[Check] Page text: ${result.bodyText}`);
        return { amount: result.amount, claimed: result.claimed };
    } catch (err) {
        console.error('[Check] Error:', err.message);
        return { amount: null, claimed: false };
    } finally {
        if (browser) await browser.close();
    }
}

async function claimTrueMoney(url) {
    let browser;
    try {
        browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
        await new Promise(r => setTimeout(r, 3000));
        console.log('[Claim] Page loaded');

        await page.click('#voucher-detail-link').catch(() => {});
        await new Promise(r => setTimeout(r, 2000));
        console.log('[Claim] Clicked info button');

        const clickOrangeButton = async () => {
            return await page.evaluate(() => {
                const buttons = document.querySelectorAll('button');
                for (const btn of buttons) {
                    const style = window.getComputedStyle(btn);
                    const bg = style.backgroundColor;
                    if (bg.includes('255, 135, 36') || bg.includes('255, 152, 0') || bg.includes('255, 87, 34') || bg.includes('249, 168, 37') ||
                        btn.textContent.includes('ตกลง') || btn.textContent.includes('ยืนยัน') ||
                        btn.textContent.includes('รับซอง') || btn.textContent.includes('OK') ||
                        btn.textContent.includes('Confirm') || btn.textContent.includes('Accept')) {
                        btn.click();
                        return true;
                    }
                }
                return false;
            });
        };

        const found = await clickOrangeButton();
        console.log('[Claim] Orange button clicked:', found);
        if (found) {
            await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 }).catch(() => {});
            await new Promise(r => setTimeout(r, 3000));
        }
        console.log('[Claim] Current URL:', page.url());

        const phoneInput = await page.$('#mobile-text-field') || await page.$('input[type="text"], input[type="tel"], input[type="number"], input:not([type])');
        if (phoneInput) {
            await phoneInput.click({ clickCount: 3 });
            await phoneInput.type(RECEIVING_PHONE, { delay: 50 });
            await new Promise(r => setTimeout(r, 1000));
            console.log('[Claim] Phone entered');
        } else {
            console.log('[Claim] No phone input found');
        }

        for (let i = 0; i < 5; i++) {
            const clicked = await clickOrangeButton();
            console.log(`[Claim] Orange button attempt ${i + 1}:`, clicked);
            if (clicked) {
                await new Promise(r => setTimeout(r, 2000));
            } else {
                break;
            }
        }

        const bodyText = await page.evaluate(() => document.body.innerText);
        console.log('[Claim] Page text after claim:', bodyText.substring(0, 500));

        console.log(`[Claim] Done claiming gift from ${url}`);
        return true;
    } catch (err) {
        console.error('[Claim] Error:', err.message);
        return false;
    } finally {
        if (browser) await browser.close();
    }
}

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

function buildTicketMenu() {
    return new StringSelectMenuBuilder()
        .setCustomId("ticket_menu")
        .setPlaceholder(" 𝐎𝐏𝐄𝐍 𝐓𝐈𝐂𝐊𝐄𝐓 ")
        .addOptions(
            new StringSelectMenuOptionBuilder().setLabel("ติดต่องาน").setDescription("𝐈𝐧𝐪𝐮𝐢𝐫𝐞 𝐚𝐧𝐝 𝐨𝐫𝐝𝐞𝐫 𝐰𝐨𝐫𝐤").setEmoji("🎫").setValue("create_ticket"),
            new StringSelectMenuOptionBuilder().setLabel("แจ้งปัญหาการใช้งาน").setDescription("𝐑𝐞𝐩𝐨𝐫𝐭 𝐚𝐧 𝐢𝐬𝐬𝐮𝐞").setEmoji("⚠️").setValue("report_issue"),
            new StringSelectMenuOptionBuilder().setLabel("ล้างตัวเลือก").setDescription("𝐑𝐞𝐬𝐞𝐭 𝐬𝐞𝐥𝐞𝐜𝐭𝐢𝐨𝐧").setEmoji("🔄").setValue("reset_ui")
        );
}

const pendingBuys = new Map();

const PRICES = {
    'Drip [Android]': { '1 วัน': 50, '3 วัน': 100, '7 วัน': 250, '15 วัน': 350, '30 วัน': 550 },
    'HG Cheat [Android]': { '1 วัน': 50, '7 วัน': 200, '15 วัน': 300, '30 วัน': 500 },
    'Primehook [Android]': { '1 วัน': 70, '3 วัน': 130, '7 วัน': 220, '30 วัน': 370 },
    'Proxy Android': { '1 วัน': 60, '3 วัน': 130, '7 วัน': 220, '15 วัน': 310, '30 วัน': 550 },
    'Fluorite [iOS]': { '1 วัน': 100, '7 วัน': 400, '31 วัน': 600 },
    'Proxy UID [iOS]': { '12 ชั่วโมง': 25, '1 วัน': 30, '3 วัน': 100, '7 วัน': 200, '30 วัน': 300 },
    'Proxy Thai [iOS]': { '1 วัน': 40, '3 วัน': 100, '7 วัน': 180, '15 วัน': 350, '31 วัน': 500 },
    'Identic [iOS]': { '1 วัน': 80, '7 วัน': 350, '31 วัน': 550 },
    'Drip Proxy [Android]': { '1 วัน': 50, '3 วัน': 100, '7 วัน': 250, '15 วัน': 350, '30 วัน': 550 },
    'Gbox [iOS]': {}
};

client.once(Events.ClientReady, async readyClient => {
    console.log(`\x1b[32mLOGGED IN AS ${readyClient.user.tag}\x1b[0m`);
    console.log(`\x1b[34mSUCCESSFULLY!\x1b[0m 彡 INFO :[ BY: \x1b[31mHYDRA\x1b[0m, \x1b[0m STATUS: \x1b[32mLOGIN BOT\x1b[0m, WORKING: \x1b[35mOKAY READY LET'S GO!\x1b[0m ]`);

    const commands = [
        {
            name: 'ตั้งค่าตั๋ว',
            description: 'สร้างหน้าเปิดตั๋วทิกเก็ต (เฉพาะแอดมิน)',
            defaultMemberPermissions: PermissionsBitField.Flags.Administrator
        },
        {
            name: 'ตั้งค่าคิว',
            description: 'สร้างป้ายเมนูสำหรับให้ลูกค้ากดรับคิว (เฉพาะแอดมิน)',
            defaultMemberPermissions: PermissionsBitField.Flags.Administrator
        },
        {
            name: 'ล้างคิว',
            description: 'รีเซ็ตคิวทั้งหมดกลับเป็น 0 (เฉพาะแอดมิน)',
            defaultMemberPermissions: PermissionsBitField.Flags.Administrator
        },
        {
            name: 'ช่วยเหลือ',
            description: 'ดูคำสั่งทั้งหมดของบอท (เฉพาะแอดมิน)',
            defaultMemberPermissions: PermissionsBitField.Flags.Administrator
        },
        {
            name: 'ซื้อ',
            description: 'สั่งซื้อสินค้า'
        }
    ];

    for (const cmd of commands) {
        try {
            await readyClient.application.commands.create(cmd);
        } catch (err) {
            console.error(`Failed to register command ${cmd.name}:`, err);
        }
    }
});

client.on(Events.InteractionCreate, async interaction => {
    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'ช่วยเหลือ') {
            const helpEmbed = new EmbedBuilder()
                .setColor('#3498db')
                .setTitle('\`\`📚\`\` คำสั่งทั้งหมดของบอทระบบคิว & ทิกเก็ต')
                .addFields(
                    { name: '\`\`🛠️\`\` สำหรับแอดมิน', value: '`/ตั้งค่าคิว` - สร้างป้ายเมนูสำหรับให้ลูกค้ากดรับคิว\n`/ล้างคิว` - รีเซ็ตคิวทั้งหมดกลับเป็น 0 \`(ล้างข้อมูลคนกดเก่า)\`\n`/ตั้งค่าตั๋ว` - สร้างหน้าเปิดตั๋วทิกเก็ต\n`/ช่วยเหลือ` - ดูคำสั่งทั้งหมดของบอท' },
                    { name: '\`\`👤\`\` สำหรับลูกค้าทั่วไป', value: 'ลูกค้าสามารถกดปุ่ม **"ลงคิว"** จากป้ายเมนูที่แอดมินสร้างขึ้นได้เลยครับ\n`/ซื้อ` - สั่งซื้อสินค้า (เลือกสินค้าจากเมนู)' }
                )
                .setImage('https://cdn.discordapp.com/attachments/1507302074231291914/1514541869814648832/embed_tumblr_042c553cb2306d437886179a502240d9_c2f6f59d_640.gif?ex=6a2d1008&is=6a2bbe88&hm=0d8067faf4ac016e9a8077e367adba21423a298d4ce2545d1f306e49c4d4bf76')
                .setTimestamp();

            return interaction.reply({ embeds: [helpEmbed], flags: MessageFlags.Ephemeral });
        }

        if (interaction.commandName === 'ตั้งค่าคิว') {
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

            await interaction.channel.send({ embeds: [queueEmbed], components: [row] });
            const successSetupEmbed = new EmbedBuilder()
                .setColor('#2ecc71')
                .setDescription('> # \`✅\` สร้างป้ายเมนูคิวสำเร็จ!');
            return interaction.reply({ embeds: [successSetupEmbed], flags: MessageFlags.Ephemeral });
        }

        if (interaction.commandName === 'ล้างคิว') {
            const queueData = { queueCount: 0, users: {} };
            saveQueue(queueData);

            const clearEmbed = new EmbedBuilder()
                .setColor('#2ecc71')
                .setDescription('> # \`✅\` ทำการล้างคิวเรียบร้อยแล้ว!');
            return interaction.reply({ embeds: [clearEmbed], flags: MessageFlags.Ephemeral });
        }

        if (interaction.commandName === 'ซื้อ') {
            const productMenu = new StringSelectMenuBuilder()
                .setCustomId(`buy_product_${interaction.user.id}`)
                .setPlaceholder(' เลือกสินค้า ')
                .addOptions(
                    new StringSelectMenuOptionBuilder().setLabel('Drip [Android]').setValue('Drip [Android]').setEmoji('💧'),
                    new StringSelectMenuOptionBuilder().setLabel('Drip Proxy [Android]').setValue('Drip Proxy [Android]').setEmoji('💧'),
                    new StringSelectMenuOptionBuilder().setLabel('Proxy Android').setValue('Proxy Android').setEmoji('🤖'),
                    new StringSelectMenuOptionBuilder().setLabel('HG Cheat [Android]').setValue('HG Cheat [Android]').setEmoji('🎮'),
                    new StringSelectMenuOptionBuilder().setLabel('Primehook [Android]').setValue('Primehook [Android]').setEmoji('🪝'),
                    new StringSelectMenuOptionBuilder().setLabel('Identic [iOS]').setValue('Identic [iOS]').setEmoji('🔗'),
                    new StringSelectMenuOptionBuilder().setLabel('Fluorite [iOS]').setValue('Fluorite [iOS]').setEmoji('💎'),
                    new StringSelectMenuOptionBuilder().setLabel('Proxy UID [iOS]').setValue('Proxy UID [iOS]').setEmoji('🆔'),
                    new StringSelectMenuOptionBuilder().setLabel('Proxy Thai [iOS]').setValue('Proxy Thai [iOS]').setEmoji('🇹🇭'),
                    new StringSelectMenuOptionBuilder().setLabel('Gbox [iOS]').setValue('Gbox [iOS]').setEmoji('📦')
                );

            const productRow = new ActionRowBuilder().addComponents(productMenu);
            const cancelRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`buy_cancel_${interaction.user.id}`)
                    .setLabel('ยกเลิก')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('✖️')
            );

            const selectEmbed = new EmbedBuilder()
                .setColor('#2b2d31')
                .setDescription(
                    `# \`\`🛒\`\` เลือกสินค้า\n\n` +
                    `> 🛍️ กรุณาเลือกสินค้าที่ต้องการจากเมนูด้านล่าง`
                )
                .setTimestamp();

            return interaction.reply({
                embeds: [selectEmbed],
                components: [productRow, cancelRow],
                flags: MessageFlags.Ephemeral
            });
        }

        if (interaction.commandName === 'ตั้งค่าตั๋ว') {
            const ticketEmbed = new EmbedBuilder()
                .setColor('#2b2d31')
                .setDescription(
                    `# \`\`🎫\`\` Ticket\n` +
                    `## หากพบปัญหาการใช้งาน หรือต้องการสอบถามเพิ่มเติม\nกรุณากดเลือกเมนูด้านล่างเพื่อเปิดตั๋วติดต่อทีมงานครับ\n\n` +
                    `> \`\`🛒\`\` **เปิดตั๋วแล้วสามารถส่งข้อมูลไว้ในห้องได้เลยครับ**\n\n`
                )
                .setImage("https://cdn.discordapp.com/attachments/1429776211437158471/1449227012139909170/Hydra_copy.png?ex=69529095&is=69513f15&hm=86d70e924f40e135cd9e7ea0d739b24fc28b3c1c465277490a5f2dfee510b171&");

            const selectRow = new ActionRowBuilder().addComponents(buildTicketMenu());

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
            await interaction.update({ components: [new ActionRowBuilder().addComponents(buildTicketMenu())] }).catch(() => {});
            return;
        }

        if (!["create_ticket", "report_issue"].includes(value)) return;

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        await interaction.message.edit({ components: [new ActionRowBuilder().addComponents(buildTicketMenu())] }).catch(() => {});

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
                    ...SUPPORT_ROLE_IDS.map(id => ({
                        id,
                        type: 0,
                        allow: [ PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory ]
                    })),
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

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith("buy_duration_")) {
        const userId = interaction.customId.replace("buy_duration_", "");
        if (interaction.user.id !== userId) {
            return interaction.reply({ content: '❌ คำสั่งซื้อนี้ไม่ใช่ของคุณ', flags: MessageFlags.Ephemeral });
        }

        const product = interaction.message.embeds[0]?.fields?.find(f => f.name.includes('สินค้า'))?.value?.replace(/`/g, '') || 'ไม่ทราบ';
        const day = interaction.values[0];

        pendingBuys.set(interaction.user.id, { product, day });

        const modal = new ModalBuilder()
            .setCustomId(`buy_modal_${interaction.user.id}`)
            .setTitle('กรอกลิ้งค์ซอง TrueMoney');

        const linkInput = new TextInputBuilder()
            .setCustomId('truemoney_link')
            .setLabel('ลิ้งค์ซอง TrueMoney')
            .setPlaceholder('https://gift.truemoney.com/campaign/?v=...')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMinLength(10);

        const actionRow = new ActionRowBuilder().addComponents(linkInput);
        modal.addComponents(actionRow);

        await interaction.showModal(modal);
        return;
    }

    if (interaction.isButton() && interaction.customId.startsWith("buy_cancel_")) {
        const userId = interaction.customId.replace("buy_cancel_", "");
        if (interaction.user.id !== userId) {
            return interaction.reply({ content: '❌ คำสั่งนี้ไม่ใช่ของคุณ', flags: MessageFlags.Ephemeral });
        }
        const cancelEmbed = new EmbedBuilder()
            .setColor('#e74c3c')
            .setDescription('> # `✖️` ยกเลิกคำสั่งซื้อแล้ว');
        return interaction.update({ embeds: [cancelEmbed], components: [] });
    }

    if (interaction.isButton() && interaction.customId.startsWith("buy_change_")) {
        const userId = interaction.customId.replace("buy_change_", "");
        if (interaction.user.id !== userId) {
            return interaction.reply({ content: '❌ คำสั่งนี้ไม่ใช่ของคุณ', flags: MessageFlags.Ephemeral });
        }

        const productMenu = new StringSelectMenuBuilder()
            .setCustomId(`buy_product_${interaction.user.id}`)
            .setPlaceholder(' เลือกสินค้า ')
            .addOptions(
                new StringSelectMenuOptionBuilder().setLabel('Drip [Android]').setValue('Drip [Android]').setEmoji('💧'),
                new StringSelectMenuOptionBuilder().setLabel('Drip Proxy [Android]').setValue('Drip Proxy [Android]').setEmoji('💧'),
                new StringSelectMenuOptionBuilder().setLabel('Proxy Android').setValue('Proxy Android').setEmoji('🤖'),
                new StringSelectMenuOptionBuilder().setLabel('HG Cheat [Android]').setValue('HG Cheat [Android]').setEmoji('🎮'),
                new StringSelectMenuOptionBuilder().setLabel('Primehook [Android]').setValue('Primehook [Android]').setEmoji('🪝'),
                new StringSelectMenuOptionBuilder().setLabel('Identic [iOS]').setValue('Identic [iOS]').setEmoji('🔗'),
                new StringSelectMenuOptionBuilder().setLabel('Fluorite [iOS]').setValue('Fluorite [iOS]').setEmoji('💎'),
                new StringSelectMenuOptionBuilder().setLabel('Proxy UID [iOS]').setValue('Proxy UID [iOS]').setEmoji('🆔'),
                new StringSelectMenuOptionBuilder().setLabel('Proxy Thai [iOS]').setValue('Proxy Thai [iOS]').setEmoji('🇹🇭'),
                new StringSelectMenuOptionBuilder().setLabel('Gbox [iOS]').setValue('Gbox [iOS]').setEmoji('📦')
            );

        const productRow = new ActionRowBuilder().addComponents(productMenu);
        const selectEmbed = new EmbedBuilder()
            .setColor('#2b2d31')
            .setDescription(
                `# \`\`🛒\`\` เลือกสินค้า\n\n` +
                `> 🛍️ กรุณาเลือกสินค้าที่ต้องการจากเมนูด้านล่าง`
            )
            .setTimestamp();

        return interaction.update({ embeds: [selectEmbed], components: [productRow] });
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith("buy_product_")) {
        const userId = interaction.customId.replace("buy_product_", "");
        if (interaction.user.id !== userId) {
            return interaction.reply({ content: '❌ คำสั่งนี้ไม่ใช่ของคุณ', flags: MessageFlags.Ephemeral });
        }

        const product = interaction.values[0];

        const emojiMap = {
            '12 ชั่วโมง': '⏰',
            '1 วัน': '1️⃣',
            '3 วัน': '3️⃣',
            '5 วัน': '5️⃣',
            '7 วัน': '7️⃣',
            '15 วัน': '🔟',
            '30 วัน': '📅'
        };

        const productPrices = PRICES[product];
        const durations = productPrices
            ? Object.keys(productPrices).map(d => ({ name: d, value: d, emoji: emojiMap[d] || '📌' }))
            : [
                { name: '1 วัน', value: '1 วัน', emoji: '1️⃣' },
                { name: '3 วัน', value: '3 วัน', emoji: '3️⃣' },
                { name: '7 วัน', value: '7 วัน', emoji: '7️⃣' },
                { name: '15 วัน', value: '15 วัน', emoji: '🔟' },
                { name: '30 วัน', value: '30 วัน', emoji: '📅' }
            ];

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`buy_duration_${interaction.user.id}`)
            .setPlaceholder(' เลือกระยะเวลา ')
            .addOptions(durations.map(d =>
                new StringSelectMenuOptionBuilder().setLabel(d.name).setValue(d.value).setEmoji(d.emoji)
            ));

        const selectRow = new ActionRowBuilder().addComponents(selectMenu);
        const cancelRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`buy_change_${interaction.user.id}`)
                .setLabel('เปลี่ยนสินค้า')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('🔄'),
            new ButtonBuilder()
                .setCustomId(`buy_cancel_${interaction.user.id}`)
                .setLabel('ยกเลิก')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('✖️')
        );

        const durationEmbed = new EmbedBuilder()
            .setColor('#2b2d31')
            .setDescription(
                `# \`\`🛒\`\` เลือกระยะเวลา\n` +
                `## สินค้า: **${product}**\n\n` +
                `> ⏳ กรุณาเลือกระยะเวลาที่ต้องการจากเมนูด้านล่าง`
            )
            .addFields(
                { name: '\`📦\` สินค้า', value: `\`\`\`${product}\`\`\``, inline: true },
                { name: '\`👤\` ผู้สั่งซื้อ', value: `${interaction.user}`, inline: true }
            )
            .setFooter({ text: 'เลือกรายการจากเมนูด้านล่าง' })
            .setTimestamp();

        return interaction.update({ embeds: [durationEmbed], components: [selectRow, cancelRow] });
    }

    if (interaction.isModalSubmit() && (interaction.customId.startsWith("buy_modal_") || interaction.customId === "truemoney_modal_retry")) {
        const userId = interaction.customId.startsWith("buy_modal_")
            ? interaction.customId.replace("buy_modal_", "")
            : interaction.user.id;
        const pending = pendingBuys.get(userId);
        if (!pending) {
            return interaction.reply({ content: '❌ ไม่พบข้อมูลคำสั่งซื้อ กรุณาลองใหม่', flags: MessageFlags.Ephemeral });
        }
        const { product, day } = pending;

        const truemoneyLink = interaction.fields.getTextInputValue('truemoney_link');
        if (!truemoneyLink.startsWith('https://gift.truemoney.com/')) {
            return interaction.reply({
                content: '❌ **ลิ้งค์ไม่ถูกต้อง** กรุณาใส่ลิ้งค์ซอง TrueMoney ที่ขึ้นต้นด้วย `https://gift.truemoney.com/`',
                flags: MessageFlags.Ephemeral
            });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        let scrapeResult = { amount: null, claimed: false };
        try {
            scrapeResult = await scrapeTrueMoneyAmount(truemoneyLink);
        } catch (err) {
            console.error('Scrape check failed:', err.message);
        }

        let expectedPrice = null;
        let underpaid = false;
        let overpaid = false;
        if (PRICES[product] && PRICES[product][day]) {
            expectedPrice = PRICES[product][day];
            if (scrapeResult.amount) {
                const actual = Number(scrapeResult.amount);
                if (actual < expectedPrice) underpaid = true;
                else if (actual > expectedPrice) overpaid = true;
            }
        }

        if (scrapeResult.claimed) {
            pendingBuys.delete(userId);
            return interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setColor('#e74c3c')
                    .setTitle('❌ ซองนี้ถูกเปิดแล้ว!')
                    .setDescription('ลิ้งค์นี้ถูกใช้ไปแล้ว กรุณาส่งลิ้งค์ใหม่')],
                components: []
            });
        }

        await interaction.editReply({ content: '🔄 กำลังตรวจสอบและรับซองเงิน...' });

        try {
            await claimTrueMoney(truemoneyLink);
        } catch (err) {
            console.error('Claim failed:', err.message);
        }

        pendingBuys.delete(userId);

        const paymentChannel = interaction.guild.channels.cache.get(PAYMENT_CHANNEL_ID);
        if (!paymentChannel) {
            console.error('Payment channel not found:', PAYMENT_CHANNEL_ID);
            return interaction.editReply({ content: '❌ ไม่พบช่องชำระเงิน กรุณาติดต่อแอดมิน' });
        }

        const hasMismatch = underpaid || overpaid;

        const paymentEmbed = new EmbedBuilder()
            .setColor(hasMismatch ? '#e74c3c' : '#f1c40f')
            .setDescription(
                overpaid
                    ? `# \`\`🔴\`\` ลูกค้าโอนเงินเกิน!\n> ต้องการ **฿${expectedPrice}** แต่ได้รับ **฿${scrapeResult.amount}**\n> ⚠️ กรุณาติดต่อลูกค้าเพื่อคืนเงินส่วนต่าง`
                    : underpaid
                    ? `# \`\`⚠️\`\` จำนวนเงินไม่พอ!\n> ต้องการ **฿${expectedPrice}** แต่ได้รับ **฿${scrapeResult.amount}**`
                    : `# \`\`💳\` ลิ้งค์ชำระเงิน\n> มีลูกค้าส่งลิ้งค์ซอง TrueMoney แล้ว`
            )
            .addFields(
                { name: '\`📦\` สินค้า', value: `\`\`\`${product}\`\`\``, inline: true },
                { name: '\`📅\` ระยะเวลา', value: `\`\`\`${day}\`\`\``, inline: true },
                { name: '\`💰\` จำนวนเงิน', value: scrapeResult.amount ? `\`\`\`฿${scrapeResult.amount}\`\`\`` : '\`\`\`ไม่สามารถดึงข้อมูลได้\`\`\`', inline: true },
                { name: '\`✅\` สถานะ', value: overpaid ? '\`\`🔴 โอนเกิน - รอติดต่อกลับ\`\`' : '\`\`\`รับซองแล้ว\`\`\`', inline: true },
                { name: '\`🕐\` เวลา', value: `<t:${Math.floor(Date.now() / 1000)}:f>`, inline: true },
                { name: '\`👤\` ผู้ส่ง', value: `${interaction.user} (${interaction.user.id})`, inline: false },
                { name: '\`📱\` เบอร์รับเงิน', value: `\`\`\`${RECEIVING_PHONE}\`\`\``, inline: true },
                { name: '\`🔗\` ลิ้งค์ซอง', value: truemoneyLink }
            )
            .setTimestamp();

        if (overpaid) {
            paymentChannel.send({ content: '@everyone', embeds: [paymentEmbed] }).catch(() => {});
        } else {
            paymentChannel.send({ embeds: [paymentEmbed] }).catch(() => {});
        }

        if (overpaid) {
            const successBuyEmbed = new EmbedBuilder()
                .setColor('#e74c3c')
                .setDescription(
                    `# \`\`🔴\`\` โอนเงินเกิน!\n` +
                    `> สินค้า: **${product}** | ระยะเวลา: **${day}**\n` +
                    `> ต้องการ: **฿${expectedPrice}** | ได้รับ: **฿${scrapeResult.amount}**\n` +
                    `> ⚠️ เงินเกิน **฿${(Number(scrapeResult.amount) - expectedPrice).toFixed(2)}**\n` +
                    `> กรุณาติดต่อแอดมินเพื่อขอคืนเงินส่วนต่าง`
                );
            return interaction.editReply({ embeds: [successBuyEmbed] });
        }

        if (underpaid) {
            const successBuyEmbed = new EmbedBuilder()
                .setColor('#e74c3c')
                .setDescription(
                    `# \`\`⚠️\`\` จำนวนเงินไม่พอ!\n` +
                    `> สินค้า: **${product}** | ระยะเวลา: **${day}**\n` +
                    `> ต้องการ: **฿${expectedPrice}** | ได้รับ: **฿${scrapeResult.amount}**\n` +
                    `> กรุณาโอนใหม่ให้ตรงจำนวน`
                );
            pendingBuys.set(userId, { product, day });
            const retryBtn = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('retry_truemoney')
                    .setLabel('🔄 ส่งลิ้งค์ใหม่')
                    .setStyle(ButtonStyle.Danger)
            );
            return interaction.editReply({ embeds: [successBuyEmbed], components: [retryBtn] });
        }

        const successBuyEmbed = new EmbedBuilder()
            .setColor('#2ecc71')
            .setDescription(
                `# \`\`✅\`\` บันทึกคำสั่งซื้อเรียบร้อย!\n` +
                `> สินค้า: **${product}** | ระยะเวลา: **${day}**\n` +
                (scrapeResult.amount ? `> จำนวนเงิน: **฿${scrapeResult.amount}**\n` : '') +
                `> ลิ้งค์ถูกส่งไปยังแอดมินแล้ว`
            );
        return interaction.editReply({ embeds: [successBuyEmbed] });
    }

    if (interaction.isButton() && interaction.customId === 'retry_truemoney') {
        const userId = interaction.user.id;
        const pending = pendingBuys.get(userId);
        if (!pending) {
            return interaction.reply({ content: '❌ ไม่พบข้อมูลคำสั่งซื้อ กรุณาเริ่มใหม่', ephemeral: true });
        }

        const modal = new ModalBuilder()
            .setCustomId('truemoney_modal_retry')
            .setTitle('ส่งลิ้งค์ซอง TrueMoney ใหม่');
        const linkInput = new TextInputBuilder()
            .setCustomId('truemoney_link')
            .setLabel('ลิ้งค์ซอง TrueMoney')
            .setPlaceholder('https://gift.truemoney.com/campaign/...')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);
        const actionRow = new ActionRowBuilder().addComponents(linkInput);
        modal.addComponents(actionRow);
        await interaction.showModal(modal);
    }

    if (interaction.isButton() && interaction.customId === "close_ticket") {
        const hasRole = interaction.member.roles.cache.some(role => SUPPORT_ROLE_IDS.includes(role.id));
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

    if (interaction.isButton() && interaction.customId === 'join_queue') {
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
