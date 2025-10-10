// Official Magic: The Gathering keywords and abilities
export const MAGIC_KEYWORDS = [
  // Evergreen keywords
  'Flying',
  'First Strike',
  'Double Strike',
  'Deathtouch',
  'Haste',
  'Hexproof',
  'Indestructible',
  'Lifelink',
  'Menace',
  'Reach',
  'Trample',
  'Vigilance',
  'Ward',
  'Flash',
  'Defender',

  // Activated abilities
  'Activated ability',
  'Tap',
  'Untap',
  'Sacrifice',

  // Triggered abilities
  'Triggered ability',
  'Enter the battlefield',
  'Enters the battlefield',
  'When',
  'Whenever',
  'At the beginning',
  'At end of turn',

  // Combat keywords
  'Attacking',
  'Blocking',
  'Combat damage',
  'Unblocked',

  // Keywords with numbers
  'Crew',
  'Equip',
  'Level up',
  'Reinforce',
  'Suspend',
  'Vanishing',

  // Graveyard keywords
  'Flashback',
  'Unearth',
  'Escape',
  'Aftermath',
  'Jump-start',

  // Mana keywords
  'Convoke',
  'Delve',
  'Improvise',
  'Affinity',

  // Other common keywords
  'Scry',
  'Mill',
  'Draw',
  'Discard',
  'Search',
  'Shuffle',
  'Exile',
  'Return',
  'Destroy',
  'Counter',
  'Prevent',
  'Token',
  'Copy',
  'Transform',
  'Manifest',
  'Morph',
  'Megamorph',
  'Cascade',
  'Storm',
  'Rebound',
  'Prowess',
  'Exploit',
  'Emerge',
  'Escalate',
  'Madness',
  'Threshold',
  'Metalcraft',
  'Landfall',
  'Kicker',
  'Multikicker',
  'Overload',
  'Cipher',
  'Evolve',
  'Undying',
  'Persist',
  'Wither',
  'Infect',
  'Regenerate',
  'Shroud',
  'Protection',
  'Fear',
  'Intimidate',
  'Shadow',
  'Horsemanship',
  'Plainswalk',
  'Islandwalk',
  'Swampwalk',
  'Mountainwalk',
  'Forestwalk',
  'Landwalk',

  // Commander-specific terms
  'Commander',
  'Experience counter',
  'Experience counters',
  'Command zone',
  'Commander tax',
  'Color identity',
  'Partner',
  'Partner with',
  'Eminence',
  'Lieutenant',

  // Card types
  'Artifact',
  'Creature',
  'Enchantment',
  'Instant',
  'Land',
  'Planeswalker',
  'Sorcery',
  'Tribal',
  'Battle',

  // Supertypes
  'Basic',
  'Legendary',
  'Snow',
  'World',

  // Colors and mana
  'White',
  'Blue',
  'Black',
  'Red',
  'Green',
  'Colorless',
  'Multicolored',
  'Monocolored',

  // Zones
  'Battlefield',
  'Hand',
  'Library',
  'Graveyard',
  'Stack',
  'Exile',

  // Game concepts
  'Turn',
  'Phase',
  'Step',
  'Priority',
  'Spell',
  'Ability',
  'Effect',
  'Permanent',
  'Nonpermanent',
  'Target',
  'Choose',
  'Control',
  'Own',
  'Mana cost',
  'Converted mana cost',
  'Mana value',
  'Power',
  'Toughness',
  'Loyalty'
];

// Function to extract keywords from card text
export function extractKeywords(oracleText: string): string[] {
  if (!oracleText) return [];

  const foundKeywords: string[] = [];
  const lowerText = oracleText.toLowerCase();

  for (const keyword of MAGIC_KEYWORDS) {
    const lowerKeyword = keyword.toLowerCase();
    if (lowerText.includes(lowerKeyword)) {
      foundKeywords.push(keyword);
    }
  }

  return Array.from(new Set(foundKeywords)); // Remove duplicates
}

// Function to identify important mechanics for Commander
export function getCommanderRelevantKeywords(keywords: string[]): string[] {
  const commanderImportant = [
    'Commander', 'Experience counter', 'Partner', 'Eminence', 'Lieutenant',
    'Flying', 'Haste', 'Trample', 'Deathtouch', 'Lifelink', 'Vigilance',
    'Mill', 'Draw', 'Artifact', 'Sacrifice', 'Graveyard',
    'Enter the battlefield', 'Search', 'Exile', 'Junk token', 'Dice'
  ];

  return keywords.filter(keyword => 
    commanderImportant.some(important => 
      keyword.toLowerCase().includes(important.toLowerCase())
    )
  );
}