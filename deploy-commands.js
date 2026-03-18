// ============================================================
// deploy-commands.js
// Run this ONCE with: node deploy-commands.js
// (or npm run deploy)
//
// This registers your slash commands with Discord so they
// show up when users type "/" in your server.
//
// You only need to re-run this when you ADD or CHANGE commands.
// ============================================================

const { REST, Routes } = require('discord.js');
const fs   = require('fs');
const path = require('path');
require('dotenv').config();

const commands = [];

// Collect all command data (the SlashCommandBuilder definitions)
const commandsPath = path.join(__dirname, 'commands');
const folders = fs.readdirSync(commandsPath);

for (const folder of folders) {
  const folderPath = path.join(commandsPath, folder);
  if (!fs.statSync(folderPath).isDirectory()) continue;

  const files = fs.readdirSync(folderPath).filter(f => f.endsWith('.js'));
  for (const file of files) {
    const command = require(path.join(folderPath, file));
    if (command.data) {
      commands.push(command.data.toJSON());
      console.log(`📝 Queued: /${command.data.name}`);
    }
  }
}

// REST = Discord's REST API client for making direct HTTP requests
const rest = new REST().setToken(process.env.TOKEN);

(async () => {
  try {
    console.log(`\n🚀 Registering ${commands.length} slash commands...`);

    // PUT replaces ALL existing guild commands with the new list
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );

    console.log('✅ All slash commands registered successfully!');
    console.log('They will appear in Discord within a few seconds.');
  } catch (error) {
    console.error('❌ Failed to register commands:', error);
  }
})();
// The (async () => { ... })() pattern is an "immediately invoked async function"
// It lets us use await at the top level
