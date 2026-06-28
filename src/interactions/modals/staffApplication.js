import { handleStaffApplicationSubmission } from '../../commands/Community/staffapply.js';

export default {
  name: 'staff_application_modal',
  async execute(interaction) {
    await handleStaffApplicationSubmission(interaction);
  },
};
