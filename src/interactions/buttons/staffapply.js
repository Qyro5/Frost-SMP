import { ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { getColor } from '../../config/bot.js';
import { errorEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { getApplicationById, getStaffConfig } from './staffapply.js';

export default {
  customId: 'staff_apply_button',
  
  async execute(interaction, client) {
    try {
      const guildId = interaction.guild.id;
      const config = getStaffConfig(guildId);

      if (!config) {
        logger.warn('Staff application button clicked but config missing', {
          event: 'staffapp.button.config_missing',
          guildId,
          userId: interaction.user.id,
          username: interaction.user.tag
        });

        return await InteractionHelper.safeReply(interaction, {
          content: '❌ Staff application is not configured. An administrator needs to run `/staffapply setup` first.',
          flags: ["Ephemeral"]
        });
      }

      // Build the staff application modal
      const { ModalBuilder, ActionRowBuilder, TextInputBuilder, TextInputStyle } = await import('discord.js');

      const modal = new ModalBuilder()
        .setCustomId('staff_application_modal:submit')
        .setTitle('Staff Application Form');

      const questions = [
        { id: 'staff_q0', label: 'What is your Discord username?', maxLength: 100 },
        { id: 'staff_q1', label: 'How old are you?', maxLength: 50 },
        { id: 'staff_q2', label: 'What timezone are you in?', maxLength: 50 },
        { id: 'staff_q3', label: 'Why do you want to become staff?', maxLength: 1000 },
        { id: 'staff_q4', label: 'Do you have previous moderation/staff experience?', maxLength: 1000 },
      ];

      questions.forEach((q) => {
        const input = new TextInputBuilder()
          .setCustomId(q.id)
          .setLabel(q.label)
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(q.maxLength);

        const row = new ActionRowBuilder().addComponents(input);
        modal.addComponents(row);
      });

      // Add the two remaining questions
      const additionalQuestions = [
        { id: 'staff_q5', label: 'How active can you be each week? (hours)', maxLength: 200 },
        { id: 'staff_q6', label: 'How would you handle a user breaking the rules?', maxLength: 1000 },
      ];

      additionalQuestions.forEach((q) => {
        const input = new TextInputBuilder()
          .setCustomId(q.id)
          .setLabel(q.label)
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(q.maxLength);

        const row = new ActionRowBuilder().addComponents(input);
        modal.addComponents(row);
      });

      logger.info('Displaying staff application modal', {
        event: 'staffapp.modal.displayed',
        userId: interaction.user.id,
        username: interaction.user.tag,
        guildId,
        guildName: interaction.guild.name
      });

      await interaction.showModal(modal);
    } catch (error) {
      logger.error('Error showing staff application modal', {
        event: 'staffapp.modal.error',
        error: error.message,
        stack: error.stack,
        userId: interaction.user.id,
        guildId: interaction.guild.id
      });

      const errorMsg = errorEmbed(
        'Modal Error',
        'Failed to open the application form. Please try again later.'
      );

      await InteractionHelper.safeReply(interaction, {
        embeds: [errorMsg],
        flags: ["Ephemeral"]
      }).catch(() => {
        logger.error('Failed to send error message for modal display', {
          event: 'staffapp.error_response.failed',
          userId: interaction.user.id
        });
      });
    }
  }
};
