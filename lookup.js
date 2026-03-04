const { SlashCommandBuilder } = require('discord.js');
const axios = require('axios');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lookup')
    .setDescription('Lookup an IP address')
    .addStringOption(option =>
      option.setName('ip')
        .setDescription('The IP address to lookup')
        .setRequired(true)
    ),

  async execute(interaction) {
    const ip = interaction.options.getString('ip');

    // Basic IP validation
    const ipRegex = /^(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)$/;
    if (!ipRegex.test(ip)) {
      return interaction.reply({ content: 'Please provide a valid IPv4 address.', ephemeral: true });
    }

    // API call
    try {
      const response = await axios.get(`http://ip-api.com/json/${ip}`);
      const data = response.data;

      if (data.status === 'fail') {
        return interaction.reply({ content: `Error: ${data.message}`, ephemeral: true });
      }

      const embed = {
        title: `IP Lookup: ${ip}`,
        fields: [
          { name: 'Country', value: data.country || 'N/A', inline: true },
          { name: 'Region', value: data.regionName || 'N/A', inline: true },
          { name: 'City', value: data.city || 'N/A', inline: true },
          { name: 'ISP', value: data.isp || 'N/A', inline: true },
          { name: 'Org', value: data.org || 'N/A', inline: true },
          { name: 'Timezone', value: data.timezone || 'N/A', inline: true },
        ],
        footer: { text: 'Data provided by ip-api.com' }
      };

      interaction.reply({ embeds: [embed] });

    } catch (err) {
      interaction.reply({ content: 'Failed to fetch IP info.', ephemeral: true });
    }
  }
};
