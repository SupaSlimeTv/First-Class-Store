// ============================================================
// commands/games/blackjack.js
// Slash command: /blackjack <bet>
// Full blackjack game with Hit/Stand buttons
//
// TEACHES: ActionRowBuilder, ButtonBuilder, component collectors,
//          game state management, card logic
// ============================================================

const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');
const { getUser, saveUser } = require('../../utils/db');
const { errorEmbed, COLORS } = require('../../utils/embeds');

// ---- CARD DECK LOGIC ----

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

function buildDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank });
    }
  }
  return deck;
}

function shuffleDeck(deck) {
  // Fisher-Yates shuffle — the correct way to shuffle an array
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]]; // destructuring swap — no temp variable needed
  }
  return deck;
}

function cardValue(rank) {
  if (['J', 'Q', 'K'].includes(rank)) return 10;
  if (rank === 'A') return 11; // aces start as 11, reduced later if needed
  return parseInt(rank);
}

function handTotal(hand) {
  let total = 0;
  let aces = 0;

  for (const card of hand) {
    total += cardValue(card.rank);
    if (card.rank === 'A') aces++;
  }

  // Reduce aces from 11 to 1 if we're busting
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }

  return total;
}

function formatHand(hand, hideSecond = false) {
  // hideSecond = true hides dealer's second card (shown as ??)
  return hand
    .map((card, i) => (hideSecond && i === 1 ? '🂠' : `${card.rank}${card.suit}`))
    .join('  ');
}

function buildGameEmbed(playerHand, dealerHand, bet, hideDealer = true, resultText = null) {
  const playerTotal = handTotal(playerHand);
  const dealerTotal = hideDealer ? '?' : handTotal(dealerHand);

  const embed = new EmbedBuilder()
    .setColor(resultText ? (resultText.includes('Win') ? COLORS.SUCCESS : COLORS.ERROR) : COLORS.GAME)
    .setTitle('🃏 Blackjack')
    .addFields(
      {
        name: `Your Hand (${playerTotal})`,
        value: formatHand(playerHand),
        inline: false,
      },
      {
        name: `Dealer's Hand (${dealerTotal})`,
        value: formatHand(dealerHand, hideDealer),
        inline: false,
      },
      {
        name: 'Bet',
        value: `$${bet.toLocaleString()}`,
        inline: true,
      }
    );

  if (resultText) embed.setDescription(`**${resultText}**`);

  return embed;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('blackjack')
    .setDescription('Play blackjack! Get closer to 21 than the dealer without going over.')
    .addIntegerOption((option) =>
      option
        .setName('bet')
        .setDescription('Amount to bet')
        .setRequired(true)
        .setMinValue(1)
    ),

  async execute(interaction) {
    const bet = interaction.options.getInteger('bet');
    const user = getUser(interaction.user.id);

    if (bet > user.wallet) {
      return interaction.reply({
        embeds: [errorEmbed(`You only have **$${user.wallet.toLocaleString()}** in your wallet!`)],
        ephemeral: true,
      });
    }

    // Build and deal
    const deck = shuffleDeck(buildDeck());
    const playerHand = [deck.pop(), deck.pop()];
    const dealerHand = [deck.pop(), deck.pop()];

    // Check for immediate blackjack
    if (handTotal(playerHand) === 21) {
      const winnings = Math.floor(bet * 1.5); // blackjack pays 3:2
      user.wallet += winnings;
      saveUser(interaction.user.id, user);

      return interaction.reply({
        embeds: [
          buildGameEmbed(playerHand, dealerHand, bet, false, `🎉 BLACKJACK! You win $${winnings.toLocaleString()}!`),
        ],
      });
    }

    // ---- BUILD HIT / STAND BUTTONS ----
    // ActionRowBuilder holds up to 5 buttons in a row
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('bj_hit')
        .setLabel('Hit')
        .setStyle(ButtonStyle.Primary),   // blue
      new ButtonBuilder()
        .setCustomId('bj_stand')
        .setLabel('Stand')
        .setStyle(ButtonStyle.Secondary), // grey
    );

    // Send the initial game state
    const gameMsg = await interaction.reply({
      embeds: [buildGameEmbed(playerHand, dealerHand, bet)],
      components: [row],
      fetchReply: true, // returns the sent message so we can edit it later
    });

    // ---- BUTTON COLLECTOR ----
    // Waits for the player to click Hit or Stand
    const collector = gameMsg.createMessageComponentCollector({
      filter: (i) => i.user.id === interaction.user.id, // only the player can click
      time: 60_000, // 60 seconds to make a move
    });

    collector.on('collect', async (btnInteraction) => {
      // Acknowledge the button click immediately (required by Discord)
      await btnInteraction.deferUpdate();

      if (btnInteraction.customId === 'bj_hit') {
        // Draw a card
        playerHand.push(deck.pop());
        const total = handTotal(playerHand);

        if (total > 21) {
          // BUST
          user.wallet -= bet;
          saveUser(interaction.user.id, user);
          collector.stop();

          return gameMsg.edit({
            embeds: [buildGameEmbed(playerHand, dealerHand, bet, false, `💥 Bust! You went over 21. -$${bet.toLocaleString()}`)],
            components: [], // remove buttons
          });
        }

        if (total === 21) {
          // Auto-stand at 21
          collector.stop('stand');
          return;
        }

        // Still in play — update the embed
        await gameMsg.edit({
          embeds: [buildGameEmbed(playerHand, dealerHand, bet)],
          components: [row],
        });

      } else if (btnInteraction.customId === 'bj_stand') {
        collector.stop('stand');
      }
    });

    collector.on('end', async (_, reason) => {
      if (reason !== 'stand') return; // timed out or bust already handled

      // ---- DEALER PLAYS ----
      // Dealer must hit until they reach 17 or more (standard casino rule)
      while (handTotal(dealerHand) < 17) {
        dealerHand.push(deck.pop());
      }

      const playerTotal = handTotal(playerHand);
      const dealerTotal = handTotal(dealerHand);

      let resultText;
      let payout;

      if (dealerTotal > 21 || playerTotal > dealerTotal) {
        resultText = `🎉 You Win! +$${bet.toLocaleString()}`;
        payout = bet;
      } else if (playerTotal === dealerTotal) {
        resultText = `🤝 Push! Bet returned.`;
        payout = 0;
      } else {
        resultText = `😞 Dealer wins. -$${bet.toLocaleString()}`;
        payout = -bet;
      }

      user.wallet += payout;
      saveUser(interaction.user.id, user);

      await gameMsg.edit({
        embeds: [buildGameEmbed(playerHand, dealerHand, bet, false, resultText)],
        components: [],
      });
    });
  },
};
