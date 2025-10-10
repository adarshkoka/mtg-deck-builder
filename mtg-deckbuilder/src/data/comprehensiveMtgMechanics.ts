/**
 * Comprehensive MTG Mechanics Database
 * 
 * This file contains exhaustive data about Magic: The Gathering mechanics,
 * tokens, synergies, and strategy archetypes to power the improved synergy analysis system.
 * 
 * Research Sources:
 * - MTG Wiki official documentation
 * - EDHREC deck statistics 
 * - Comprehensive Rules
 * - Official Wizards articles
 */

// ============================================================================
// PREDEFINED TOKENS
// ============================================================================

export interface TokenDefinition {
  name: string;
  type: string;
  rules: string;
  commonSynergies: string[];
  strategicValue: 'high' | 'medium' | 'low';
}

export const PREDEFINED_TOKENS: Record<string, TokenDefinition> = {
  'Treasure': {
    name: 'Treasure',
    type: 'Artifact',
    rules: '{T}, Sacrifice this artifact: Add one mana of any color.',
    commonSynergies: ['artifact synergies', 'sacrifice effects', 'ramp strategies', 'proliferate'],
    strategicValue: 'high'
  },
  'Food': {
    name: 'Food',
    type: 'Artifact',
    rules: '{2}, {T}, Sacrifice this artifact: You gain 3 life.',
    commonSynergies: ['artifact synergies', 'lifegain strategies', 'sacrifice effects'],
    strategicValue: 'medium'
  },
  'Blood': {
    name: 'Blood',
    type: 'Artifact',
    rules: '{1}, {T}, Discard a card, Sacrifice this artifact: Draw a card.',
    commonSynergies: ['artifact synergies', 'discard effects', 'card draw', 'madness'],
    strategicValue: 'medium'
  },
  'Clue': {
    name: 'Clue',
    type: 'Artifact',
    rules: '{2}, Sacrifice this artifact: Draw a card.',
    commonSynergies: ['artifact synergies', 'investigate', 'card draw engines'],
    strategicValue: 'high'
  },
  'Junk': {
    name: 'Junk',
    type: 'Artifact',
    rules: '{T}, Sacrifice this artifact: Exile the top card of your library. You may play that card this turn.',
    commonSynergies: ['artifact synergies', 'sacrifice effects', 'impulse draw'],
    strategicValue: 'medium'
  },
  'Map': {
    name: 'Map',
    type: 'Artifact',
    rules: '{1}, {T}, Sacrifice this artifact: Target creature you control explores.',
    commonSynergies: ['artifact synergies', 'explore', '+1/+1 counters', 'lands matter'],
    strategicValue: 'medium'
  },
  'Powerstone': {
    name: 'Powerstone',
    type: 'Artifact',
    rules: '{T}: Add {C}. This mana cannot be spent to cast a nonartifact spell.',
    commonSynergies: ['artifact synergies', 'artifact ramp', 'colorless matters'],
    strategicValue: 'medium'
  }
};

// ============================================================================
// KEYWORD ABILITIES (Comprehensive List)
// ============================================================================

export interface KeywordAbility {
  name: string;
  category: 'evergreen' | 'returning' | 'one-time';
  description: string;
  colors: string[];
  synergiesWith: string[];
  countersBy: string[];
}

export const KEYWORD_ABILITIES: Record<string, KeywordAbility> = {
  'Flying': {
    name: 'Flying',
    category: 'evergreen',
    description: 'Can only be blocked by creatures with flying or reach',
    colors: ['White', 'Blue'],
    synergiesWith: ['evasion strategies', 'tempo', 'voltron'],
    countersBy: ['reach', 'flying blockers', 'direct removal']
  },
  'Trample': {
    name: 'Trample',
    category: 'evergreen',
    description: 'Excess damage is dealt to defending player',
    colors: ['Red', 'Green'],
    synergiesWith: ['large creatures', 'power matters', 'voltron', '+1/+1 counters'],
    countersBy: ['large blockers', 'fog effects', 'damage prevention']
  },
  'Deathtouch': {
    name: 'Deathtouch',
    category: 'evergreen',
    description: 'Any damage dealt destroys target creature',
    colors: ['Black', 'Green'],
    synergiesWith: ['small creatures', 'equipment', 'combat tricks', 'aristocrats'],
    countersBy: ['first strike', 'indestructible', 'protection']
  },
  'Lifelink': {
    name: 'Lifelink',
    category: 'evergreen',
    description: 'Damage dealt also causes you to gain that much life',
    colors: ['White', 'Black'],
    synergiesWith: ['lifegain strategies', 'aggressive decks', 'soul sisters'],
    countersBy: ['prevent combat damage', 'damage redirection']
  },
  'Vigilance': {
    name: 'Vigilance',
    category: 'evergreen',
    description: 'Does not tap when attacking',
    colors: ['White'],
    synergiesWith: ['aggro-control', 'tap abilities', 'equipment'],
    countersBy: ['forced combat', 'tap effects']
  },
  'First Strike': {
    name: 'First Strike',
    category: 'evergreen',
    description: 'Deals combat damage before creatures without first strike',
    colors: ['White', 'Red'],
    synergiesWith: ['combat tricks', 'equipment', 'voltron'],
    countersBy: ['first strike', 'double strike', 'damage prevention']
  },
  'Double Strike': {
    name: 'Double Strike',
    category: 'evergreen',
    description: 'Deals first strike and regular combat damage',
    colors: ['Red', 'White'],
    synergiesWith: ['equipment', 'auras', 'voltron', 'power boosting'],
    countersBy: ['damage prevention', 'large blockers']
  },
  'Haste': {
    name: 'Haste',
    category: 'evergreen',
    description: 'Can attack and use tap abilities immediately',
    colors: ['Red'],
    synergiesWith: ['aggro', 'tempo', 'reanimator', 'combo'],
    countersBy: ['instant speed removal', 'fog effects']
  },
  'Reach': {
    name: 'Reach',
    category: 'evergreen',
    description: 'Can block creatures with flying',
    colors: ['Green'],
    synergiesWith: ['defensive strategies', 'flying hate'],
    countersBy: ['non-flying evasion', 'removal']
  },
  'Hexproof': {
    name: 'Hexproof',
    category: 'evergreen',
    description: 'Cannot be targeted by spells or abilities opponents control',
    colors: ['Green', 'Blue'],
    synergiesWith: ['voltron', 'auras', 'equipment', 'combo protection'],
    countersBy: ['board wipes', 'sacrifice effects', 'combat damage']
  },
  'Indestructible': {
    name: 'Indestructible',
    category: 'evergreen',
    description: 'Cannot be destroyed by damage or destroy effects',
    colors: ['White'],
    synergiesWith: ['voltron', 'control finishers', 'damage-based strategies'],
    countersBy: ['exile', 'sacrifice', 'toughness reduction', 'bouncing']
  },
  'Menace': {
    name: 'Menace',
    category: 'evergreen',
    description: 'Can only be blocked by two or more creatures',
    colors: ['Black', 'Red'],
    synergiesWith: ['aggro', 'tempo', 'voltron'],
    countersBy: ['multiple small blockers', 'removal']
  },
  'Ward': {
    name: 'Ward',
    category: 'evergreen',
    description: 'Spells and abilities that target this cost an additional cost',
    colors: ['Blue', 'White'],
    synergiesWith: ['voltron', 'protection strategies', 'tempo'],
    countersBy: ['unconditional removal', 'sacrifice effects']
  },
  'Flash': {
    name: 'Flash',
    category: 'evergreen',
    description: 'Can be cast at instant speed',
    colors: ['Blue'],
    synergiesWith: ['control', 'tempo', 'surprise blockers', 'combo'],
    countersBy: ['cannot be countered', 'immediate responses']
  },
  'Defender': {
    name: 'Defender',
    category: 'evergreen',
    description: 'Cannot attack',
    colors: ['All'],
    synergiesWith: ['wall tribal', 'defender matters', 'control'],
    countersBy: ['removal', 'forced combat effects']
  }
};

// ============================================================================
// KEYWORD ACTIONS (Comprehensive List)
// ============================================================================

export const KEYWORD_ACTIONS = [
  'Activate', 'Attach', 'Cast', 'Counter', 'Create', 'Destroy', 'Discard',
  'Double', 'Exchange', 'Exile', 'Fight', 'Mill', 'Play', 'Regenerate',
  'Reveal', 'Sacrifice', 'Scry', 'Search', 'Shuffle', 'Tap', 'Untap',
  'Fateseal', 'Clash', 'Planeswalk', 'Set in Motion', 'Abandon', 'Proliferate',
  'Transform', 'Detain', 'Populate', 'Monstrosity', 'Vote', 'Bolster',
  'Manifest', 'Support', 'Investigate', 'Meld', 'Goad', 'Exert', 'Explore',
  'Assemble', 'Surveil', 'Adapt', 'Amass', 'Learn', 'Venture into the Dungeon',
  'Connive', 'Open an Attraction', 'Roll to Visit Your Attractions', 'Convert',
  'Incubate', 'The Ring Tempts You', 'Face a Villainous Choice', 'Time Travel',
  'Discover', 'Cloak', 'Collect Evidence', 'Suspect', 'Forage', 'Manifest Dread'
];

// ============================================================================
// ABILITY WORDS (No rules meaning, thematic grouping)
// ============================================================================

export const ABILITY_WORDS = [
  'Landfall', 'Metalcraft', 'Battalion', 'Bloodrush', 'Channel', 'Chroma',
  'Constellation', 'Converge', 'Delirium', 'Domain', 'Fateful Hour', 'Ferocious',
  'Formidable', 'Grandeur', 'Hellbent', 'Heroic', 'Imprint', 'Join Forces',
  'Kinship', 'Landfall', 'Lieutenant', 'Morbid', 'Parley', 'Radiance', 'Raid',
  'Rally', 'Revolt', 'Spell Mastery', 'Strive', 'Sweep', 'Tempting Offer',
  'Threshold', 'Undergrowth', 'Will of the Council', 'Addendum', 'Spectacle',
  'Alliance', 'Coven', 'Magecraft', 'Pack Tactics', 'Party'
];

// ============================================================================
// COUNTER TYPES AND PROLIFERATE SYNERGIES
// ============================================================================

export interface CounterType {
  name: string;
  type: 'beneficial' | 'detrimental' | 'neutral';
  commonOn: string[];
  proliferateValue: 'high' | 'medium' | 'low';
  synergiesWith: string[];
}

export const COUNTER_TYPES: Record<string, CounterType> = {
  '+1/+1': {
    name: '+1/+1 Counter',
    type: 'beneficial',
    commonOn: ['creatures'],
    proliferateValue: 'high',
    synergiesWith: ['go-wide strategies', 'voltron', 'modular', 'undying', 'persist']
  },
  '-1/-1': {
    name: '-1/-1 Counter',
    type: 'detrimental',
    commonOn: ['creatures'],
    proliferateValue: 'medium',
    synergiesWith: ['infect', 'wither', 'creature removal']
  },
  'Loyalty': {
    name: 'Loyalty Counter',
    type: 'beneficial',
    commonOn: ['planeswalkers'],
    proliferateValue: 'high',
    synergiesWith: ['planeswalker strategies', 'superfriends']
  },
  'Poison': {
    name: 'Poison Counter',
    type: 'detrimental',
    commonOn: ['players'],
    proliferateValue: 'high',
    synergiesWith: ['infect', 'toxic', 'alternative win conditions']
  },
  'Energy': {
    name: 'Energy Counter',
    type: 'beneficial',
    commonOn: ['players'],
    proliferateValue: 'high',
    synergiesWith: ['energy strategies', 'artifact synergies']
  },
  'Charge': {
    name: 'Charge Counter',
    type: 'beneficial',
    commonOn: ['artifacts'],
    proliferateValue: 'medium',
    synergiesWith: ['artifact strategies', 'activated abilities']
  },
  'Oil': {
    name: 'Oil Counter',
    type: 'beneficial',
    commonOn: ['artifacts', 'creatures'],
    proliferateValue: 'high',
    synergiesWith: ['Phyrexian strategies', 'artifact synergies']
  }
};

// ============================================================================
// CROSS-MECHANIC SYNERGY RULES
// ============================================================================

export interface SynergyRule {
  name: string;
  mechanics: string[];
  synergyStrength: number; // 1-10 scale
  description: string;
  examples: string[];
}

export const CROSS_MECHANIC_SYNERGIES: SynergyRule[] = [
  {
    name: 'Proliferate + Counter Strategies',
    mechanics: ['proliferate', '+1/+1 counters', 'loyalty counters', 'energy counters'],
    synergyStrength: 9,
    description: 'Proliferate dramatically accelerates any counter-based strategy',
    examples: ['Atraxa + planeswalkers', 'Energy deck with proliferate', 'Modular artifacts']
  },
  {
    name: 'Sacrifice + Token Generation',
    mechanics: ['sacrifice', 'token generation', 'aristocrats'],
    synergyStrength: 8,
    description: 'Tokens provide expendable resources for sacrifice effects',
    examples: ['Treasures + sacrifice outlets', 'Creature tokens + blood artist effects']
  },
  {
    name: 'Equipment + Double Strike',
    mechanics: ['equipment', 'double strike', 'voltron'],
    synergyStrength: 8,
    description: 'Equipment bonuses apply to both combat damage instances',
    examples: ['Sword effects trigger twice', 'Power boosting equipment']
  },
  {
    name: 'Landfall + Ramp',
    mechanics: ['landfall', 'ramp', 'lands matter'],
    synergyStrength: 7,
    description: 'Extra land drops trigger landfall abilities multiple times',
    examples: ['Exploration effects', 'Fetch lands', 'Land-based ramp spells']
  },
  {
    name: 'Flashback + Mill/Discard',
    mechanics: ['flashback', 'mill', 'discard', 'graveyard'],
    synergyStrength: 7,
    description: 'Self-mill enables flashback value engines',
    examples: ['Faithless Looting effects', 'Dredge enablers']
  },
  {
    name: 'Dice Rolling + Triggered Abilities',
    mechanics: ['dice rolling', 'triggered abilities', 'value engines'],
    synergyStrength: 6,
    description: 'Multiple dice rolls trigger abilities multiple times',
    examples: ['Mr. House + dice synergies', 'Roll modifiers']
  },
  {
    name: 'Energy + Artifacts',
    mechanics: ['energy', 'artifacts', 'artifact synergies'],
    synergyStrength: 6,
    description: 'Many energy producers are artifacts, creating dual synergies',
    examples: ['Servo Exhibition', 'Implement artifacts']
  }
];

// ============================================================================
// STRATEGY ARCHETYPES
// ============================================================================

export interface StrategyArchetype {
  name: string;
  description: string;
  keyMechanics: string[];
  cardTypes: string[];
  colors: string[];
  popularityRank: number; // Based on EDHREC data
  deckCount: number;
  synergyPriority: 'speed' | 'value' | 'protection' | 'consistency';
}

export const STRATEGY_ARCHETYPES: Record<string, StrategyArchetype> = {
  'Tokens': {
    name: 'Token Strategies',
    description: 'Generate multiple creatures to overwhelm opponents (go-wide)',
    keyMechanics: ['token generation', 'populate', 'convoke', 'anthem effects'],
    cardTypes: ['creatures', 'enchantments', 'sorceries'],
    colors: ['White', 'Green'],
    popularityRank: 1,
    deckCount: 168077,
    synergyPriority: 'value'
  },
  'Artifacts': {
    name: 'Artifact Strategies',
    description: 'Leverage artifacts for ramp, utility, and synergies',
    keyMechanics: ['artifact synergies', 'improvise', 'affinity', 'treasure'],
    cardTypes: ['artifacts', 'creatures'],
    colors: ['Blue', 'Red', 'Colorless'],
    popularityRank: 2,
    deckCount: 151075,
    synergyPriority: 'value'
  },
  'Plus One Counters': {
    name: '+1/+1 Counter Strategies',
    description: 'Build up creatures with +1/+1 counters over time',
    keyMechanics: ['+1/+1 counters', 'proliferate', 'modular', 'undying'],
    cardTypes: ['creatures', 'instants', 'sorceries'],
    colors: ['Green', 'White'],
    popularityRank: 3,
    deckCount: 144120,
    synergyPriority: 'value'
  },
  'Aristocrats': {
    name: 'Aristocrat Strategies',
    description: 'Sacrifice creatures for value and damage effects',
    keyMechanics: ['sacrifice', 'death triggers', 'token generation'],
    cardTypes: ['creatures', 'enchantments'],
    colors: ['Black', 'Red', 'White'],
    popularityRank: 7,
    deckCount: 84211,
    synergyPriority: 'value'
  },
  'Equipment': {
    name: 'Equipment Strategies',
    description: 'Enhance creatures with equipment for powerful attacks',
    keyMechanics: ['equipment', 'attach', 'voltron'],
    cardTypes: ['artifacts', 'creatures'],
    colors: ['White', 'Red'],
    popularityRank: 8,
    deckCount: 82432,
    synergyPriority: 'protection'
  },
  'Voltron': {
    name: 'Voltron Strategies',
    description: 'Focus all resources on making one creature extremely powerful',
    keyMechanics: ['auras', 'equipment', 'protection', 'evasion'],
    cardTypes: ['auras', 'equipment', 'instants'],
    colors: ['All'],
    popularityRank: 22,
    deckCount: 40850,
    synergyPriority: 'protection'
  },
  'Spellslinger': {
    name: 'Spellslinger Strategies',
    description: 'Cast many noncreature spells for value and win conditions',
    keyMechanics: ['prowess', 'storm', 'magecraft', 'instant/sorcery matters'],
    cardTypes: ['instants', 'sorceries', 'creatures'],
    colors: ['Blue', 'Red'],
    popularityRank: 9,
    deckCount: 82336,
    synergyPriority: 'speed'
  },
  'Control': {
    name: 'Control Strategies',
    description: 'Counter threats and control the game until winning with finishers',
    keyMechanics: ['counterspells', 'card draw', 'removal'],
    cardTypes: ['instants', 'sorceries', 'planeswalkers'],
    colors: ['Blue', 'White', 'Black'],
    popularityRank: 20,
    deckCount: 46340,
    synergyPriority: 'consistency'
  },
  'Aggro': {
    name: 'Aggressive Strategies',
    description: 'Deploy threats quickly and pressure opponents early',
    keyMechanics: ['haste', 'low mana cost', 'evasion', 'burn'],
    cardTypes: ['creatures', 'instants'],
    colors: ['Red', 'White'],
    popularityRank: 11,
    deckCount: 69216,
    synergyPriority: 'speed'
  },
  'Ramp': {
    name: 'Ramp Strategies', 
    description: 'Accelerate mana to cast expensive threats ahead of curve',
    keyMechanics: ['mana acceleration', 'landfall', 'big creatures'],
    cardTypes: ['sorceries', 'artifacts', 'creatures'],
    colors: ['Green'],
    popularityRank: 21,
    deckCount: 42715,
    synergyPriority: 'consistency'
  }
};

// ============================================================================
// MECHANIC CATEGORIES (For Synergy Analysis)
// ============================================================================

export interface MechanicCategory {
  name: string;
  description: string;
  mechanics: string[];
  synergyMultiplier: number; // How much to weight internal synergies
}

export const MECHANIC_CATEGORIES: Record<string, MechanicCategory> = {
  'Linear': {
    name: 'Linear Mechanics',
    description: 'Mechanics that scale with more copies (tribal, counters)',
    mechanics: ['tribal', '+1/+1 counters', 'artifacts matter', 'spells matter'],
    synergyMultiplier: 1.5
  },
  'Parasitic': {
    name: 'Parasitic Mechanics',
    description: 'Mechanics that only work with specific sets/blocks',
    mechanics: ['energy', 'splice onto arcane', 'bushido'],
    synergyMultiplier: 2.0
  },
  'Modular': {
    name: 'Modular Mechanics',
    description: 'Mechanics that work independently',
    mechanics: ['flying', 'removal', 'card draw'],
    synergyMultiplier: 1.0
  },
  'Scalable': {
    name: 'Scalable Mechanics',
    description: 'Mechanics that work at different power levels',
    mechanics: ['X spells', 'kicker', 'multikicker'],
    synergyMultiplier: 1.2
  },
  'Smoothing': {
    name: 'Smoothing Mechanics',
    description: 'Mechanics that improve card quality/consistency',
    mechanics: ['scry', 'cycling', 'card draw'],
    synergyMultiplier: 1.1
  }
};

// ============================================================================
// EXPORT ALL DATA
// ============================================================================

export const COMPREHENSIVE_MTG_DATA = {
  tokens: PREDEFINED_TOKENS,
  keywordAbilities: KEYWORD_ABILITIES,
  keywordActions: KEYWORD_ACTIONS,
  abilityWords: ABILITY_WORDS,
  counterTypes: COUNTER_TYPES,
  crossMechanicSynergies: CROSS_MECHANIC_SYNERGIES,
  strategyArchetypes: STRATEGY_ARCHETYPES,
  mechanicCategories: MECHANIC_CATEGORIES
};

export default COMPREHENSIVE_MTG_DATA;