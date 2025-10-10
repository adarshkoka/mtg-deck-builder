/**
 * Research: Best Custom EDH Deck Examples for Synergy Validation
 * 
 * This file contains well-documented, successful EDH deck examples that showcase
 * strong synergistic interactions. These examples will be used to validate our
 * enhanced synergy analysis system.
 */

export interface TestDeckExample {
  commanderName: string;
  primaryStrategy: string;
  keyCards: string[];
  expectedSynergies: string[];
  popularityRanking: number;
  totalDecksOnEDHREC: number;
}

/**
 * Curated list of successful EDH deck examples with known strong synergies
 */
export const SUCCESSFUL_EDH_EXAMPLES: TestDeckExample[] = [
  {
    commanderName: "Atraxa, Praetors' Voice",
    primaryStrategy: "Proliferate/+1/+1 Counters",
    keyCards: [
      "Doubling Season",
      "Hardened Scales", 
      "Cathars' Crusade",
      "Corpsejack Menace",
      "Planewalker Proliferate Package",
      "Luminarch Aspirant",
      "Evolution Sage",
      "Viral Drake"
    ],
    expectedSynergies: [
      "Proliferate + +1/+1 Counters (9/10 strength)",
      "Proliferate + Planeswalker Loyalty (8/10 strength)",
      "Double Counter Effects + Token Generation (8/10 strength)",
      "Landfall + Proliferate triggers (7/10 strength)"
    ],
    popularityRanking: 1,
    totalDecksOnEDHREC: 15000
  },

  {
    commanderName: "Ghired, Conclave Exile", 
    primaryStrategy: "Token Generation/Populate",
    keyCards: [
      "Rhys the Redeemed",
      "Anointed Procession", 
      "Parallel Lives",
      "Cathar's Crusade",
      "Beast Whisperer",
      "Avenger of Zendikar",
      "Craterhoof Behemoth",
      "Tendershoot Dryad"
    ],
    expectedSynergies: [
      "Token Doubling + Token Generation (9/10 strength)",
      "Tokens + Anthem Effects (8/10 strength)", 
      "Tokens + Card Draw (7/10 strength)",
      "Landfall + Token Creation (7/10 strength)"
    ],
    popularityRanking: 25,
    totalDecksOnEDHREC: 3500
  },

  {
    commanderName: "Urza, Lord High Artificer",
    primaryStrategy: "Artifact Synergies/Combo",
    keyCards: [
      "Winter Orb",
      "Static Orb", 
      "Dramatic Reversal",
      "Isochron Scepter",
      "Sensei's Divining Top",
      "Mystic Forge",
      "Etherium Sculptor",
      "Grand Architect"
    ],
    expectedSynergies: [
      "Artifact Cost Reduction + High CMC Artifacts (9/10 strength)",
      "Mana Artifacts + Stax Effects (8/10 strength)",
      "Combo Enablers + Protection (8/10 strength)",
      "Card Selection + Top Deck Manipulation (7/10 strength)"
    ],
    popularityRanking: 5,
    totalDecksOnEDHREC: 8500
  },

  {
    commanderName: "Korvold, Fae-Cursed King",
    primaryStrategy: "Sacrifice/Value Engine", 
    keyCards: [
      "Sakura-Tribe Elder",
      "Viscera Seer",
      "Ashnod's Altar",
      "Mayhem Devil",
      "Trail of Crumbs", 
      "Tireless Tracker",
      "Academy Rector",
      "Bitterblossom"
    ],
    expectedSynergies: [
      "Sacrifice Outlets + Death Triggers (9/10 strength)",
      "Sacrifice + Card Draw (8/10 strength)",
      "Token Generation + Sacrifice Value (8/10 strength)",
      "Treasures + Artifact Sacrifice (7/10 strength)"
    ],
    popularityRanking: 3,
    totalDecksOnEDHREC: 12000
  },

  {
    commanderName: "Animar, Soul of Elements",
    primaryStrategy: "Creature Cost Reduction/Combo",
    keyCards: [
      "Ancestral Statue",
      "Beast Whisperer",
      "Soul of the Harvest", 
      "Primordial Sage",
      "Shrieking Drake",
      "Man-o'-War",
      "Cloudstone Curio",
      "Imperial Recruiter"
    ],
    expectedSynergies: [
      "Cost Reduction + Creature ETB (9/10 strength)",
      "Creature Cast + Card Draw (8/10 strength)",
      "Bounce Effects + Cost Reduction (8/10 strength)",
      "Counter Generation + Protection (7/10 strength)"
    ],
    popularityRanking: 15,
    totalDecksOnEDHREC: 5500
  }
];

/**
 * Token-focused deck archetypes with known successful patterns
 */
export const TOKEN_DECK_EXAMPLES = [
  {
    strategy: "Go-Wide Tokens",
    keyCards: ["Anointed Procession", "Parallel Lives", "Cathar's Crusade"],
    expectedSynergies: ["Token Doubling", "Mass Pump Effects", "Overrun Effects"]
  },
  {
    strategy: "Aristocrats (Sacrifice Tokens)",
    keyCards: ["Blood Artist", "Zulaport Cutthroat", "Ashnod's Altar"],
    expectedSynergies: ["Death Triggers", "Sacrifice Outlets", "Token Generation"]
  },
  {
    strategy: "Token + +1/+1 Counters",
    keyCards: ["Hardened Scales", "Master Biomancer", "Cathars' Crusade"],
    expectedSynergies: ["Counter Multiplication", "Counter Placement", "Mass Enhancement"]
  }
];

/**
 * Artifact deck archetypes with established synergy patterns
 */
export const ARTIFACT_DECK_EXAMPLES = [
  {
    strategy: "Treasure/Artifact Ramp",
    keyCards: ["Smothering Tithe", "Dockside Extortionist", "Goldspan Dragon"],
    expectedSynergies: ["Treasure Generation", "Artifact Sacrifice", "Mana Acceleration"]
  },
  {
    strategy: "Artifact Creatures/Tribal",
    keyCards: ["Steel Overseer", "Arcbound Ravager", "Master of Etherium"],
    expectedSynergies: ["Artifact Tribal", "Modular Mechanics", "Mass Artifact Support"]
  },
  {
    strategy: "Artifact Storm/Combo",
    keyCards: ["Krark-Clan Ironworks", "Scrap Trawler", "Myr Retriever"],
    expectedSynergies: ["Artifact Recursion", "Cost Reduction", "Storm Count"]
  }
];

/**
 * Validation criteria for testing synergy analysis
 */
export const SYNERGY_VALIDATION_CRITERIA = {
  highSynergyThreshold: 7, // Score of 7+ indicates strong synergy
  mediumSynergyThreshold: 4, // Score of 4-6 indicates moderate synergy  
  lowSynergyThreshold: 2, // Score of 2-3 indicates weak synergy
  expectedAccuracy: 0.8, // 80% of known synergies should score above threshold
  
  testCases: [
    {
      card1: "Doubling Season",
      card2: "Atraxa, Praetors' Voice", 
      expectedScore: 8,
      reason: "Proliferate + Token/Counter doubling"
    },
    {
      card1: "Anointed Procession", 
      card2: "Rhys the Redeemed",
      expectedScore: 9,
      reason: "Token doubling + Token generation"
    },
    {
      card1: "Ashnod's Altar",
      card2: "Korvold, Fae-Cursed King",
      expectedScore: 8, 
      reason: "Sacrifice outlet + Sacrifice payoff"
    },
    {
      card1: "Smothering Tithe",
      card2: "Marionette Master", 
      expectedScore: 7,
      reason: "Treasure generation + Artifact death triggers"
    }
  ]
};

/**
 * Anti-synergy examples (should score low)
 */
export const ANTI_SYNERGY_EXAMPLES = [
  {
    card1: "Rest in Peace",
    card2: "Korvold, Fae-Cursed King",
    expectedScore: 1,
    reason: "Graveyard hate vs graveyard synergies"
  },
  {
    card1: "Stony Silence", 
    card2: "Urza, Lord High Artificer",
    expectedScore: 0,
    reason: "Artifact hate vs artifact commander"
  }
];

export default {
  SUCCESSFUL_EDH_EXAMPLES,
  TOKEN_DECK_EXAMPLES, 
  ARTIFACT_DECK_EXAMPLES,
  SYNERGY_VALIDATION_CRITERIA,
  ANTI_SYNERGY_EXAMPLES
};