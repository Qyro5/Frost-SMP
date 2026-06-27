import { getColor } from '../../config/bot.js';
import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { createEmbed, successEmbed, infoEmbed, warningEmbed } from '../../utils/embeds.js';
import { getGuildConfig } from '../../services/guildConfig.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError, replyUserError, ErrorTypes } from '../../utils/errorHandler.js';

import ticketConfig from './modules/ticket_dashboard.js';

// Ticket types with descriptions
export const TICKET_TYPES = {
  general: {
    id: 'general',
    name: '🎫 General Support',
    description: 'Ask general questions and get help from the community. Perfect for how-tos, setup assistance, and general inquiries.',
    emoji: '🎫',
    color: '#3498DB'
  },
  senior: {
    id: 'senior',
    name: '⭐ Senior Support',
    description: 'Priority support for complex issues. Get assistance from experienced staff members for advanced problems.',
    emoji: '⭐',
    color: '#F1C40F'
  },
  partnership: {
    id: 'partnership',
    name: '🤝 Partnership',
    description: 'Business inquiries and partnership opportunities. Contact us about collaborations and strategic partnerships.',
    emoji: '🤝',
    color: '#2ECC71'
  },
  report: {
    id: 'report',
    name: '⚠️ Report Issue',
    description: 'Report bugs, exploits, or violations. Help us maintain a safe and fair environment by reporting problems.',
    emoji: '⚠️',
    color: '#E74C3C'
  }
};

export default {
    data: new SlashCommandBuilder()
        .setName("ticket")
        .setDescription("Manages the server's ticket system.")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
        .addSubcommand((subcommand) =>
            subcommand
                .setName("setup")
                .setDescription(
                    "Sets up the ticket creation panel in a specified channel.",
                )
                .addChannelOption((option) =>
                    option
                        .setName("panel_channel")
                        .setDescription(
                            "The channel where the ticket panel will be sent.",
                        )
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true),
                )
                .addStringOption((option) =>
                    option
                        .setName("panel_message")
                        .setDescription(
                            "The main message/description for the ticket panel.",
                        )
                        .setRequired(true),
                )
                .addStringOption((option) =>
                    option
                        .setName("button_label")
                        .setDescription(
                            "The label for the ticket creation button (default: Create Ticket)",
                        )
                        .setRequired(false),
                )
                .addChannelOption((option) =>
                    option
                        .setName("category")
                        .setDescription(
                            "The category where new tickets will be created (optional).",
                        )
                        .addChannelTypes(ChannelType.GuildCategory)
                        .setRequired(false),
                )
                .addChannelOption((option) =>
                    option
                        .setName("closed_category")
                        .setDescription(
                            "The category where closed tickets will be moved (optional).",
                        )
                        .addChannelTypes(ChannelType.GuildCategory)
                        .setRequired(false),
                )
                .addRoleOption((option) =>
                    option
                        .setName("staff_role")
                        .setDescription(
                            "The role that can access tickets (optional).",
                        )
                        .setRequired(false),
                )
                .addIntegerOption((option) =>
                    option
                        .setName("max_tickets_per_user")
                        .setDescription("Maximum number of tickets a user can create (default: 3)")
                        .setMinValue(1)
                        .setMaxValue(10)
                        .setRequired(false),
                )
                .addBooleanOption((option) =>
                    option
                        .setName("dm_on_close")
                        .setDescription("Send DM to user when their ticket is closed (default: true)")
                        .setRequired(false),
                ),
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName("dashboard")
                .setDescription("Open the interactive ticket system dashboard"),
        ),
    category: "ticket",

    async execute(interaction, config, client) {
        try {
            const deferred = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
            if (!deferred) {
                return;
            }

            if (
                !interaction.member.permissions.has(
                    PermissionFlagsBits.ManageChannels,
                )
            ) {
                logger.warn('Ticket command permission denied', {
                    event: 'ticket.setup.permission_denied',
                    userId: interaction.user.id,
                    userTag: interaction.user.tag,
                    guildId: interaction.guild.id,
                    guildName: interaction.guild.name,
                    commandName: 'ticket'
                });
                return await replyUserError(interaction, { type: ErrorTypes.PERMISSION, message: 'You need the `Manage Channels` permission for this action.' });
            }

            const subcommand = interaction.options.getSubcommand();

            if (subcommand === "dashboard") {
                return ticketConfig.execute(interaction, config, client);
            }

            if (subcommand === "setup") {
                const existingConfig = await getGuildConfig(client, interaction.guild.id);
                if (existingConfig?.ticketPanelChannelId) {
                    logger.warn('Ticket setup attempted but already configured', {
                        event: 'ticket.setup.already_configured',
                        userId: interaction.user.id,
                        guildId: interaction.guild.id,
                        existingPanelChannel: existingConfig.ticketPanelChannelId
                    });
                    return await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: `This server already has a ticket system set up (panel in <#${existingConfig.ticketPanelChannelId}>). Use \`/ticket dashboard\` to manage it.` });
                }

                const panelChannel = interaction.options.getChannel("panel_channel");
                const categoryChannel = interaction.options.getChannel("category");
                const closedCategoryChannel = interaction.options.getChannel("closed_category");
                const staffRole = interaction.options.getRole("staff_role");
                const panelMessage = interaction.options.getString("panel_message") || "Click below to select a ticket type and create a support ticket.";
                const buttonLabel = interaction.options.getString("button_label") || "Create Ticket";
                const maxTicketsPerUser = interaction.options.getInteger("max_tickets_per_user") || 3;
                const dmOnClose = interaction.options.getBoolean("dm_on_close") !== false;

                const setupEmbed = new EmbedBuilder()
                    .setColor(getColor('embeds.colors.info'))
                    .setTitle("🎫 Support Tickets")
                    .setDescription(panelMessage)
                    .addFields(
                        {
                            name: '📋 Ticket Types Available',
                            value: Object.values(TICKET_TYPES)
                                .map(type => `**${type.name}** - ${type.description}`)
                                .join('\n\n'),
                            inline: false
                        },
                        {
                            name: '💡 How it works',
                            value: '1. Click the button below\n2. Select your ticket type\n3. A private channel will be created\n4. Our staff will assist you shortly',
                            inline: false
                        }
                    )
                    .setFooter({
                        text: 'Your privacy and satisfaction matter to us',
                        iconURL: interaction.client.user.displayAvatarURL()
                    });

                const ticketButton = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId("create_ticket")
                        .setLabel(buttonLabel)
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji("📩"),
                );

                try {
                    const sentPanel = await panelChannel.send({
                        embeds: [setupEmbed],
                        components: [ticketButton],
                    });

                    if (client.db && interaction.guild.id) {
                        const currentConfig = existingConfig || {};
                        currentConfig.ticketCategoryId = categoryChannel ? categoryChannel.id : null;
                        currentConfig.ticketClosedCategoryId = closedCategoryChannel ? closedCategoryChannel.id : null;
                        currentConfig.ticketStaffRoleId = staffRole ? staffRole.id : null;
                        currentConfig.ticketPanelChannelId = panelChannel.id;
                        currentConfig.ticketPanelMessageId = sentPanel?.id || null;
                        currentConfig.ticketPanelMessage = panelMessage;
                        currentConfig.ticketButtonLabel = buttonLabel;
                        currentConfig.maxTicketsPerUser = maxTicketsPerUser;
                        currentConfig.dmOnClose = dmOnClose;
                        currentConfig.ticketTypes = Object.keys(TICKET_TYPES);

                        const { getGuildConfigKey } = await import('../../utils/database.js');
                        const configKey = getGuildConfigKey(interaction.guild.id);
                        await client.db.set(configKey, currentConfig);
                        
                        logger.info('Ticket system configuration saved', {
                            event: 'ticket.setup.config_saved',
                            guildId: interaction.guild.id,
                            panelChannelId: panelChannel.id,
                            categoryId: categoryChannel?.id,
                            closedCategoryId: closedCategoryChannel?.id,
                            staffRoleId: staffRole?.id,
                            maxTickets: maxTicketsPerUser,
                            dmOnClose: dmOnClose,
                            ticketTypes: Object.keys(TICKET_TYPES).length
                        });
                    }

                    let successMessage = `✅ The ticket creation panel has been sent to ${panelChannel}.\n\n`;
                    
                    if (categoryChannel) {
                        successMessage += `**Ticket Category:** ${categoryChannel}\n`;
                    } else {
                        successMessage += '**Ticket Category:** New "Tickets" category will be created\n';
                    }
                    
                    if (closedCategoryChannel) {
                        successMessage += `**Closed Category:** ${closedCategoryChannel}\n`;
                    }
                    
                    if (staffRole) {
                        successMessage += `**Staff Role:** ${staffRole}\n`;
                    }
                    
                    successMessage += `\n**Max Tickets Per User:** ${maxTicketsPerUser}\n**DM on Close:** ${dmOnClose ? '✅ Enabled' : '❌ Disabled'}\n\n**Available Ticket Types:** ${Object.keys(TICKET_TYPES).length} (General, Senior Support, Partnership, Report)`;

                    await InteractionHelper.safeEditReply(interaction, {
                        embeds: [
                            successEmbed(
                                "✅ Ticket System Set Up",
                                successMessage,
                            ),
                        ],
                    });

                    logger.info('Ticket system setup completed', {
                        event: 'ticket.setup.completed',
                        userId: interaction.user.id,
                        userTag: interaction.user.tag,
                        guildId: interaction.guild.id,
                        guildName: interaction.guild.name,
                        panelChannelId: panelChannel.id,
                        categoryId: categoryChannel?.id,
                        closedCategoryId: closedCategoryChannel?.id,
                        staffRoleId: staffRole?.id,
                        maxTickets: maxTicketsPerUser,
                        dmOnClose: dmOnClose,
                        messageId: sentPanel?.id,
                        ticketTypesCount: Object.keys(TICKET_TYPES).length
                    });

                } catch (error) {
                    logger.error('Ticket panel creation failed', {
                        event: 'ticket.setup.panel_creation_failed',
                        error: error.message,
                        stack: error.stack,
                        userId: interaction.user.id,
                        guildId: interaction.guild.id,
                        panelChannelId: panelChannel.id
                    });
                    
                    if (interaction.deferred || interaction.replied) {
                        await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'Could not send the ticket panel or save configuration. Check the bot\'s permissions.' }).catch((err) => {
                            logger.error('Failed to send error reply for ticket setup', {
                                event: 'ticket.setup.error_reply_failed',
                                error: err.message,
                                guildId: interaction.guild.id
                            });
                        });
                    } else {
                        await handleInteractionError(interaction, error, {
                            commandName: 'ticket_setup',
                            source: 'ticket_setup_command'
                        });
                    }
                }
            }
        } catch (error) {
            logger.error('Error executing ticket command', {
                event: 'ticket.command.error',
                error: error.message,
                stack: error.stack,
                userId: interaction.user.id,
                userTag: interaction.user.tag,
                guildId: interaction.guild.id,
                commandName: 'ticket'
            });
            await handleInteractionError(interaction, error, {
                commandName: 'ticket',
                source: 'ticket_command_main'
            });
        }
    }
};
