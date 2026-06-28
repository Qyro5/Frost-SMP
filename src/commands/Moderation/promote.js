import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { successEmbed } from '../../utils/embeds.js';
import { handleInteractionError, TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';

function formatAnnouncement({ member, fromRole, toRole, status, reason }) {
  const fromText = fromRole ? ` From ${fromRole.name}` : '';
  const reasonText = reason ? `\n-# ${reason}` : '';

  return `${member}${fromText} → ${toRole.name} [ ${status} ]${reasonText}`;
}

function getPromotionStatus(fromRole, toRole, selectedStatus) {
  if (selectedStatus) {
    return selectedStatus;
  }

  if (!fromRole) {
    return 'Hired';
  }

  return toRole.position < fromRole.position ? 'Demoted' : 'Promoted';
}

export default {
  slashOnly: true,
  data: new SlashCommandBuilder()
    .setName('promote')
    .setDescription('Promote, hire, or demote a member and announce it')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('The member receiving the role change')
        .setRequired(true),
    )
    .addRoleOption((option) =>
      option
        .setName('role')
        .setDescription('The new role')
        .setRequired(true),
    )
    .addRoleOption((option) =>
      option
        .setName('from_role')
        .setDescription('The previous role to show and remove, if any'),
    )
    .addStringOption((option) =>
      option
        .setName('status')
        .setDescription('Announcement status')
        .addChoices(
          { name: 'Hired', value: 'Hired' },
          { name: 'Promoted', value: 'Promoted' },
          { name: 'Demoted', value: 'Demoted' },
        ),
    )
    .addStringOption((option) =>
      option
        .setName('reason')
        .setDescription('Optional reason for the announcement')
        .setMaxLength(300),
    )
    .addChannelOption((option) =>
      option
        .setName('channel')
        .setDescription('Channel to post the announcement in')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
    ),

  category: 'moderation',

  async execute(interaction) {
    try {
      await InteractionHelper.safeDefer(interaction, { flags: ['Ephemeral'] });

      const member = interaction.options.getMember('user');
      const toRole = interaction.options.getRole('role');
      const fromRole = interaction.options.getRole('from_role');
      const selectedStatus = interaction.options.getString('status');
      const reason = interaction.options.getString('reason');
      const selectedChannel = interaction.options.getChannel('channel');
      const configuredChannelId = process.env.PROMOTION_CHANNEL_ID;
      const announcementChannel = selectedChannel
        || (configuredChannelId ? interaction.guild.channels.cache.get(configuredChannelId) : null);

      if (!member) {
        throw new TitanBotError(
          'Member not found',
          ErrorTypes.USER_INPUT,
          'That user is not currently in this server.',
        );
      }

      if (!announcementChannel) {
        throw new TitanBotError(
          'Missing promotion announcement channel',
          ErrorTypes.CONFIGURATION,
          'Choose a channel in the command or set PROMOTION_CHANNEL_ID in your .env file.',
        );
      }

      if (!announcementChannel.isTextBased?.()) {
        throw new TitanBotError(
          'Invalid promotion announcement channel',
          ErrorTypes.VALIDATION,
          'The announcement channel must be a text channel.',
        );
      }

      if (toRole.managed || toRole.id === interaction.guild.id) {
        throw new TitanBotError(
          'Invalid target role',
          ErrorTypes.VALIDATION,
          'That role cannot be assigned by the bot.',
        );
      }

      if (fromRole?.managed || fromRole?.id === interaction.guild.id) {
        throw new TitanBotError(
          'Invalid previous role',
          ErrorTypes.VALIDATION,
          'That previous role cannot be removed by the bot.',
        );
      }

      if (toRole.position >= interaction.guild.members.me.roles.highest.position) {
        throw new TitanBotError(
          'Bot role too low',
          ErrorTypes.PERMISSION,
          `I cannot assign ${toRole} because it is higher than or equal to my highest role.`,
        );
      }

      if (fromRole && fromRole.position >= interaction.guild.members.me.roles.highest.position) {
        throw new TitanBotError(
          'Bot role too low',
          ErrorTypes.PERMISSION,
          `I cannot remove ${fromRole} because it is higher than or equal to my highest role.`,
        );
      }

      if (toRole.position >= interaction.member.roles.highest.position && interaction.guild.ownerId !== interaction.user.id) {
        throw new TitanBotError(
          'Role hierarchy blocked',
          ErrorTypes.PERMISSION,
          `You cannot assign ${toRole} because it is higher than or equal to your highest role.`,
        );
      }

      if (fromRole && fromRole.position >= interaction.member.roles.highest.position && interaction.guild.ownerId !== interaction.user.id) {
        throw new TitanBotError(
          'Role hierarchy blocked',
          ErrorTypes.PERMISSION,
          `You cannot remove ${fromRole} because it is higher than or equal to your highest role.`,
        );
      }

      await member.roles.add(toRole, `Promotion command run by ${interaction.user.tag}`);

      if (fromRole && member.roles.cache.has(fromRole.id) && fromRole.id !== toRole.id) {
        await member.roles.remove(fromRole, `Promotion command run by ${interaction.user.tag}`);
      }

      const status = getPromotionStatus(fromRole, toRole, selectedStatus);
      const announcement = formatAnnouncement({
        member,
        fromRole,
        toRole,
        status,
        reason,
      });

      await announcementChannel.send({ content: announcement });

      await InteractionHelper.safeEditReply(interaction, {
        embeds: [
          successEmbed(
            'Role Change Announced',
            `Posted in ${announcementChannel}.\n\n${announcement}`,
          ),
        ],
      });

      logger.info('Promotion announcement posted', {
        event: 'promotion.announcement.posted',
        guildId: interaction.guild.id,
        userId: member.id,
        toRoleId: toRole.id,
        fromRoleId: fromRole?.id,
        channelId: announcementChannel.id,
        status,
        moderatorId: interaction.user.id,
      });
    } catch (error) {
      logger.error('Promote command error:', error);
      await handleInteractionError(interaction, error, { subtype: 'promote_failed' });
    }
  },
};
