import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { getColor } from '../../config/bot.js';
import { successEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError, withErrorHandling } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

const STAFF_APPLICATION_QUESTIONS = [
  { question: "What is your Discord username?", required: true },
  { question: "How old are you?", required: true },
  { question: "What timezone are you in, and how active can you be each week?", required: true },
  { question: "Why do you want to become a staff member?", required: true },
  { question: "Do you have moderation experience, and how would you handle a rule breaker?", required: true },
];

function getConfiguredStaffApp(guildId) {
  const runtimeConfig = global.staffAppConfigs?.[guildId];
  if (runtimeConfig) {
    return runtimeConfig;
  }

  if (process.env.STAFF_APPLICATION_CHANNEL_ID && process.env.STAFF_ROLE_ID) {
    return {
      reviewChannelId: process.env.STAFF_APPLICATION_CHANNEL_ID,
      staffRoleId: process.env.STAFF_ROLE_ID,
      source: 'env',
    };
  }

  return null;
}

export default {
  slashOnly: true,
  data: new SlashCommandBuilder()
    .setName("staffapply")
    .setDescription("Apply for a staff position")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("form")
        .setDescription("Show the staff application form with button"),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("setup")
        .setDescription("Configure staff application settings")
        .addChannelOption((option) =>
          option
            .setName("review_channel")
            .setDescription("Channel where applications will be reviewed")
            .setRequired(true),
        )
        .addRoleOption((option) =>
          option
            .setName("staff_role")
            .setDescription("Role required to review applications")
            .setRequired(true),
        ),
    ),

  category: "Community",

  execute: withErrorHandling(async (interaction) => {
    if (!interaction.inGuild()) {
      return await InteractionHelper.safeReply(interaction, {
        content: '❌ This command can only be used in a server.',
        flags: ["Ephemeral"]
      });
    }

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "form") {
      await handleStaffApplicationForm(interaction);
    } else if (subcommand === "setup") {
      await handleSetup(interaction);
    }
  }, { type: 'command', commandName: 'staffapply' })
};

async function handleSetup(interaction) {
  try {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
      logger.warn('Unauthorized staff application setup attempt', {
        event: 'staffapp.setup.unauthorized',
        guildId: interaction.guild.id,
        guildName: interaction.guild.name,
        userId: interaction.user.id,
        userTag: interaction.user.tag
      });

      return await InteractionHelper.safeReply(interaction, {
        content: 'You need the Manage Server permission to configure staff applications.',
        flags: ["Ephemeral"]
      });
    }

    await InteractionHelper.safeDefer(interaction);

    const reviewChannel = interaction.options.getChannel("review_channel");
    const staffRole = interaction.options.getRole("staff_role");

    const guildId = interaction.guild.id;

    if (!global.staffAppConfigs) {
      global.staffAppConfigs = {};
    }
    
    global.staffAppConfigs[guildId] = {
      reviewChannelId: reviewChannel.id,
      staffRoleId: staffRole.id,
      createdAt: new Date().toISOString()
    };

    const embed = successEmbed(
      '✅ Staff Application Setup Complete',
      `**Review Channel:** ${reviewChannel}\n` +
      `**Staff Role:** ${staffRole}\n\n` +
      `Staff applications will now be sent to ${reviewChannel} and reviewed by users with the ${staffRole} role.`
    );

    await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });

    logger.info('Staff application settings updated', {
      event: 'staffapp.setup.updated',
      guildId,
      guildName: interaction.guild.name,
      reviewChannelId: reviewChannel.id,
      staffRoleId: staffRole.id,
      userId: interaction.user.id,
      userTag: interaction.user.tag
    });
  } catch (error) {
    logger.error('Error in staffapply setup:', {
      error: error.message,
      guildId: interaction.guild.id,
      stack: error.stack
    });
    
    await handleInteractionError(interaction, error, {
      type: 'command',
      commandName: 'staffapply_setup'
    });
  }
}

async function handleStaffApplicationForm(interaction) {
  try {
    const guildId = interaction.guild.id;
    
    // Get configuration
    const config = global.staffAppConfigs?.[guildId];
    
    if (!config) {
      return await InteractionHelper.safeReply(interaction, {
        content: '❌ Staff application is not configured. An administrator needs to run `/staffapply setup` first.',
        flags: ["Ephemeral"]
      });
    }

    // Create the embed with rules and button
    const embed = new EmbedBuilder()
      .setColor(getColor('embeds.colors.primary'))
      .setTitle('🎖️ Staff Application Form')
      .setDescription(
        'Are you interested in joining our staff team? We\'re looking for responsible, dedicated members to help moderate and manage the community.\n\n' +
        'Click the button below to start your application!'
      )
      .addFields(
        {
          name: '📋 Staff Rules & Requirements',
          value: 
            '• Must be active in the community for at least 2 weeks\n' +
            '• Must be at least 18 years old\n' +
            '• Must be able to remain neutral and fair in all situations\n' +
            '• Must follow all server rules strictly\n' +
            '• Must communicate professionally at all times\n' +
            '• Must be available for at least 10 hours per week\n' +
            '• Violation of rules may result in staff removal',
          inline: false
        },
        {
          name: '✨ Staff Responsibilities',
          value:
            '• Monitor chat for rule violations\n' +
            '• Respond to user reports and issues\n' +
            '• Help maintain a positive community atmosphere\n' +
            '• Assist other staff members\n' +
            '• Enforce server policies fairly and consistently',
          inline: false
        },
        {
          name: '⏱️ Processing Time',
          value: 'Applications are reviewed within 3-7 business days. You will be notified via DM with the result.',
          inline: false
        }
      )
      .setFooter({
        text: 'Thank you for your interest in our staff team!',
        iconURL: interaction.client.user.displayAvatarURL()
      })
      .setTimestamp();

    // Create button
    const applyButton = new ButtonBuilder()
      .setCustomId('staff_apply_button')
      .setLabel('Apply Now')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('📝');

    const row = new ActionRowBuilder().addComponents(applyButton);

    await InteractionHelper.safeReply(interaction, {
      embeds: [embed],
      components: [row]
    });

    logger.info('Staff application form displayed', {
      guildId: interaction.guild.id,
      userId: interaction.user.id
    });
  } catch (error) {
    logger.error('Error displaying staff application form:', {
      error: error.message,
      guildId: interaction.guild.id,
      stack: error.stack
    });
    
    await handleInteractionError(interaction, error, {
      type: 'command',
      commandName: 'staffapply_form'
    });
  }
}

export async function handleStaffApplicationSubmission(interaction) {
  if (!interaction.isModalSubmit()) return;
  if (!interaction.customId.startsWith('staff_application_modal:')) return;

  try {
    const guildId = interaction.guild.id;
    const config = global.staffAppConfigs?.[guildId];

    if (!config) {
      return await InteractionHelper.safeReply(interaction, {
        content: '❌ Staff application configuration is missing.',
        flags: ["Ephemeral"]
      });
    }

    // Get review channel
    const reviewChannel = interaction.guild.channels.cache.get(config.reviewChannelId);
    if (!reviewChannel) {
      return await InteractionHelper.safeReply(interaction, {
        content: '❌ Staff review channel not found. Please contact an administrator.',
        flags: ["Ephemeral"]
      });
    }

    // Collect answers from modal
    const answers = [];
    for (let i = 0; i < STAFF_APPLICATION_QUESTIONS.length; i++) {
      try {
        const answer = interaction.fields.getTextInputValue(`staff_q${i}`);
        answers.push({
          question: STAFF_APPLICATION_QUESTIONS[i].question,
          answer: answer
        });
      } catch (e) {
        logger.warn(`Could not retrieve answer for question ${i}`, { error: e.message });
      }
    }

    // Generate unique application ID
    const applicationId = `SA-${Date.now()}-${interaction.user.id.slice(-6)}`;
    const submissionTime = new Date();

    // Create embed for review channel with status: Pending
    const reviewEmbed = new EmbedBuilder()
      .setColor(getColor('embeds.colors.warning')) // Yellow for pending
      .setTitle('📋 New Staff Application')
      .setDescription(`**Application ID:** \`${applicationId}\`\n**Status:** 🟡 Pending`)
      .addFields(
        {
          name: '👤 Applicant',
          value: `${interaction.user} (${interaction.user.id})`,
          inline: false
        },
        {
          name: '⏰ Submission Time',
          value: submissionTime.toLocaleString(),
          inline: false
        },
        ...answers.map((item, idx) => ({
          name: `Q${idx + 1}: ${item.question}`,
          value: item.answer.substring(0, 1024) || 'No response',
          inline: false
        }))
      )
      .setFooter({
        text: `Application ID: ${applicationId}`,
        iconURL: interaction.user.displayAvatarURL()
      })
      .setTimestamp();

    // Create action buttons for review
    const acceptButton = new ButtonBuilder()
      .setCustomId(`staff_accept:${applicationId}:${interaction.user.id}`)
      .setLabel('Accept')
      .setStyle(ButtonStyle.Success)
      .setEmoji('✅');

    const denyButton = new ButtonBuilder()
      .setCustomId(`staff_deny:${applicationId}:${interaction.user.id}`)
      .setLabel('Deny')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('❌');

    const buttonRow = new ActionRowBuilder().addComponents(acceptButton, denyButton);

    // Send application to review channel
    const sentMessage = await reviewChannel.send({
      embeds: [reviewEmbed],
      components: [buttonRow]
    });

    // Store application info for later reference (could use database)
    if (!global.staffApplications) {
      global.staffApplications = {};
    }
    
    global.staffApplications[applicationId] = {
      messageId: sentMessage.id,
      channelId: reviewChannel.id,
      userId: interaction.user.id,
      guildId,
      status: 'pending',
      answers,
      submittedAt: submissionTime.toISOString()
    };

    // Send confirmation to applicant
    const confirmEmbed = successEmbed(
      '✅ Application Submitted',
      `Your staff application has been submitted successfully!\n\n` +
      `**Application ID:** \`${applicationId}\`\n` +
      `**Status:** 🟡 Pending\n\n` +
      `You will receive a direct message with the result of your application within 3-7 business days.\n\n` +
      `Thank you for applying to our staff team!`
    );

    await InteractionHelper.safeReply(interaction, {
      embeds: [confirmEmbed],
      flags: ["Ephemeral"]
    });

    logger.info('Staff application submitted', {
      applicationId,
      userId: interaction.user.id,
      guildId,
      messageId: sentMessage.id
    });
  } catch (error) {
    logger.error('Error processing staff application:', {
      error: error.message,
      userId: interaction.user.id,
      guildId: interaction.guild.id,
      stack: error.stack
    });

    await handleInteractionError(interaction, error, {
      type: 'modal',
      handler: 'staff_application'
    });
  }
}

export async function getApplicationById(applicationId) {
  return global.staffApplications?.[applicationId] || null;
}

export function getStaffConfig(guildId) {
  return global.staffAppConfigs?.[guildId] || null;
}

export const QUESTIONS = STAFF_APPLICATION_QUESTIONS;
