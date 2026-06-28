import { ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits, ActionRowBuilder } from 'discord.js';
import { getColor } from '../../config/bot.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { getApplicationById, getStaffConfig } from '../../commands/Community/staffapply.js';

function createStaffReviewButton(action) {
  return {
    name: `staff_${action}`,

    async execute(interaction, client, args) {
      try {
        const applicationId = args[0];
        const applicantUserId = args[1];

      if (!action || !applicationId || !applicantUserId) {
        logger.warn('Invalid staff review button parameters', {
          event: 'staffapp.review_button.invalid_args',
          customId: interaction.customId,
          userId: interaction.user.id
        });
        
        return await InteractionHelper.safeReply(interaction, {
          content: '❌ Invalid button configuration. Please contact an administrator.',
          flags: ["Ephemeral"]
        });
      }

      const guildId = interaction.guild.id;
      const config = getStaffConfig(guildId);

      if (!config) {
        logger.warn('Staff review button clicked but config missing', {
          event: 'staffapp.review_button.config_missing',
          guildId,
          userId: interaction.user.id
        });

        return await InteractionHelper.safeReply(interaction, {
          content: '❌ Staff application configuration not found.',
          flags: ["Ephemeral"]
        });
      }

      // Check if user has permission to review applications
      const staffRole = interaction.guild.roles.cache.get(config.staffRoleId);
      const hasStaffRole = interaction.member.roles.cache.has(config.staffRoleId);
      const hasManageGuild = interaction.member.permissions.has(PermissionFlagsBits.ManageGuild);

      if (!hasStaffRole && !hasManageGuild) {
        logger.warn('Unauthorized staff application review attempt', {
          event: 'staffapp.review_button.unauthorized',
          userId: interaction.user.id,
          username: interaction.user.tag,
          guildId,
          guildName: interaction.guild.name,
          action,
          applicationId
        });

        return await InteractionHelper.safeReply(interaction, {
          content: `❌ You don't have permission to review applications. You need the ${staffRole?.toString() || 'Staff'} role or Manage Guild permission.`,
          flags: ["Ephemeral"]
        });
      }

      // Get the application data
      const application = getApplicationById(applicationId);
      if (!application) {
        logger.warn('Staff application not found', {
          event: 'staffapp.review_button.app_not_found',
          applicationId,
          userId: interaction.user.id,
          guildId
        });

        return await InteractionHelper.safeReply(interaction, {
          content: '❌ Application not found. It may have expired.',
          flags: ["Ephemeral"]
        });
      }

      await InteractionHelper.safeDefer(interaction);

      // Get the applicant user
      const applicant = await client.users.fetch(applicantUserId).catch(() => null);
      const applicantMember = await interaction.guild.members.fetch(applicantUserId).catch(() => null);
      if (!applicant) {
        logger.warn('Could not fetch applicant for staff review decision', {
          event: 'staffapp.review_button.applicant_fetch_failed',
          applicantUserId,
          userId: interaction.user.id,
          guildId
        });
      }

      // Update application status
      const statusEmoji = action === 'accept' ? '✅' : '❌';
      const statusText = action === 'accept' ? 'Accepted' : 'Denied';
      const statusColor = action === 'accept' ? getColor('embeds.colors.success') : getColor('embeds.colors.error');
      let roleAssigned = false;
      let roleAssignError = null;

      if (action === 'accept') {
        if (!applicantMember) {
          roleAssignError = 'Applicant is no longer in this server.';
        } else if (!staffRole) {
          roleAssignError = 'Configured staff role was not found.';
        } else {
          try {
            await applicantMember.roles.add(staffRole, `Staff application ${applicationId} accepted by ${interaction.user.tag}`);
            roleAssigned = true;
          } catch (error) {
            roleAssignError = error.message;
            logger.error('Failed to assign staff role after accepting application', {
              event: 'staffapp.review_button.role_assign_failed',
              error: error.message,
              applicationId,
              applicantUserId,
              staffRoleId: config.staffRoleId,
              guildId
            });
          }
        }
      }

      // Update the embed in the review channel
      const reviewChannel = interaction.guild.channels.cache.get(config.reviewChannelId);
      if (reviewChannel && application.messageId) {
        try {
          const message = await reviewChannel.messages.fetch(application.messageId).catch(() => null);
          if (message && message.embeds.length > 0) {
            const embed = EmbedBuilder.from(message.embeds[0])
              .setColor(statusColor)
              .setDescription(
                message.embeds[0].description.replace(
                  /\*\*Status:\*\* .+/,
                  `**Status:** ${statusEmoji} ${statusText}`
                )
              );

            // Disable buttons
            const disabledButtons = [];
            if (message.components.length > 0) {
              for (const row of message.components) {
                const newRow = new ActionRowBuilder();
                for (const button of row.components) {
                  if (button.type === 2) { // Button type
                    newRow.addComponents(
                      new ButtonBuilder(button.data)
                        .setDisabled(true)
                    );
                  }
                }
                disabledButtons.push(newRow);
              }
            }

            await message.edit({
              embeds: [embed],
              components: disabledButtons
            });

            logger.info('Staff application review embed updated', {
              event: 'staffapp.review_button.embed_updated',
              applicationId,
              action,
              reviewedBy: interaction.user.id,
              reviewedByTag: interaction.user.tag,
              guildId,
              guildName: interaction.guild.name
            });
          }
        } catch (error) {
          logger.error('Failed to update application embed in review channel', {
            event: 'staffapp.review_button.embed_update_failed',
            error: error.message,
            applicationId,
            messageId: application.messageId,
            channelId: config.reviewChannelId
          });
        }
      }

      // Try to send DM to applicant
      let dmSent = false;
      if (applicant) {
        try {
          const dmEmbed = new EmbedBuilder()
            .setColor(statusColor)
            .setTitle(`Staff Application ${statusText} 🎖️`)
            .setDescription(
              action === 'accept'
                ? '🎉 Congratulations! Your staff application has been **accepted**!\n\n' +
                  'Welcome to the staff team! An administrator will contact you shortly with next steps.\n\n' +
                  'Thank you for your interest and dedication to the community!'
                : '❌ Your staff application has been **denied**.\n\n' +
                  'Thank you for applying! We encourage you to stay active in the community and feel free to apply again in the future.'
            )
            .addFields({
              name: 'Application ID',
              value: `\`${applicationId}\``,
              inline: true
            })
            .setFooter({
              text: `From ${interaction.guild.name}`,
              iconURL: interaction.guild.iconURL()
            })
            .setTimestamp();

          await applicant.send({ embeds: [dmEmbed] });
          dmSent = true;

          logger.info('Staff application decision DM sent to applicant', {
            event: 'staffapp.review_button.dm_sent',
            action,
            applicantId: applicant.id,
            applicantTag: applicant.tag,
            applicationId,
            guildId
          });
        } catch (dmError) {
          logger.warn('Could not send DM to applicant', {
            event: 'staffapp.review_button.dm_failed',
            reason: dmError.message,
            applicantId: applicantUserId,
            applicationId,
            guildId
          });
        }
      }

      // Update global application status
      if (global.staffApplications?.[applicationId]) {
        global.staffApplications[applicationId].status = action === 'accept' ? 'accepted' : 'denied';
        global.staffApplications[applicationId].reviewedBy = interaction.user.id;
        global.staffApplications[applicationId].reviewedAt = new Date().toISOString();
      }

      // Send confirmation to reviewer
      const confirmEmbed = successEmbed(
        `✅ Application ${statusText}`,
        `You have successfully ${action === 'accept' ? 'accepted' : 'denied'} application \`${applicationId}\`.\n\n` +
        `${dmSent ? '✓ The applicant has been notified via DM.' : '⚠️ Could not send DM to applicant (DMs may be closed).'}` +
        `${action === 'accept' ? `\n${roleAssigned ? `Assigned ${staffRole}.` : `Could not assign staff role: ${roleAssignError}`}` : ''}`
      );

      await InteractionHelper.safeEditReply(interaction, {
        embeds: [confirmEmbed]
      });

      // Log to review channel
      const logEmbed = new EmbedBuilder()
        .setColor(statusColor)
        .setTitle(`Application Review Decision Logged`)
        .addFields(
          { name: 'Application ID', value: `\`${applicationId}\``, inline: true },
          { name: 'Decision', value: statusText, inline: true },
          { name: 'Reviewed By', value: `${interaction.user} (${interaction.user.id})`, inline: false },
          { name: 'Timestamp', value: new Date().toLocaleString(), inline: false }
        )
        .setFooter({
          text: 'Staff Review Log',
          iconURL: interaction.user.displayAvatarURL()
        });

      if (reviewChannel) {
        await reviewChannel.send({ embeds: [logEmbed] }).catch((err) => {
          logger.error('Failed to send review log to channel', {
            event: 'staffapp.review_button.log_send_failed',
            error: err.message,
            channelId: reviewChannel.id
          });
        });
      }

      logger.info('Staff application review decision processed', {
        event: 'staffapp.review_button.decision_processed',
        action,
        applicationId,
        applicantId: applicantUserId,
        reviewedBy: interaction.user.id,
        reviewedByTag: interaction.user.tag,
        dmSent,
        guildId,
        guildName: interaction.guild.name
      });
      } catch (error) {
        logger.error('Error processing staff application review', {
          event: 'staffapp.review_button.error',
          error: error.message,
          stack: error.stack,
          customId: interaction.customId,
          userId: interaction.user.id,
          guildId: interaction.guild.id
        });

        const errorMsg = errorEmbed(
          'Review Error',
          'An error occurred while processing your decision. Please try again or contact an administrator.'
        );

        await InteractionHelper.safeReply(interaction, {
          embeds: [errorMsg],
          flags: ["Ephemeral"]
        }).catch(() => {
          logger.error('Failed to send error message for staff review button', {
            event: 'staffapp.review_button.error_response_failed',
            userId: interaction.user.id
          });
        });
      }
    }
  };
}

export default [
  createStaffReviewButton('accept'),
  createStaffReviewButton('deny'),
];
