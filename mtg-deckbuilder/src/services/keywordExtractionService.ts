import type { ScryfallCard } from '../types/scryfall';

/**
 * Represents the extracted features from a card for synergy analysis
 */
export interface CardFeatures {
  tribes: Set<string>;
  mechanics: Set<string>;
  triggers: Set<string>;
  enablers: Set<string>;
  keywords: Set<string>;
  types: Set<string>;
  subtypes: Set<string>;
}

/**
 * Enhanced keyword extraction service for graph-based synergy analysis
 * Based on Phase 3 plan for comprehensive MTG mechanic extraction
 */
export class KeywordExtractionService {
  private readonly tribalTypes = new Set([
    'Angel', 'Artifact', 'Assassin', 'Assembly-Worker', 'Atog', 'Aurochs', 'Avatar', 'Badger', 'Barbarian', 'Bard', 'Basilisk', 'Bat', 'Bear', 'Beast', 'Beeble', 'Berserker', 'Bird', 'Blinkmoth', 'Boar', 'Bringer', 'Brushwagg', 'Camarid', 'Camel', 'Caribou', 'Carrier', 'Cat', 'Centaur', 'Cephalid', 'Chimera', 'Citizen', 'Cleric', 'Cockatrice', 'Construct', 'Coward', 'Crab', 'Crocodile', 'Cyclops', 'Dauthi', 'Demon', 'Deserter', 'Devil', 'Djinn', 'Dragon', 'Drake', 'Dreadnought', 'Drone', 'Druid', 'Dryad', 'Dwarf', 'Efreet', 'Egg', 'Elder', 'Eldrazi', 'Elemental', 'Elephant', 'Elf', 'Elk', 'Eye', 'Faerie', 'Ferret', 'Fish', 'Flagbearer', 'Fox', 'Frog', 'Fungus', 'Gargoyle', 'Germ', 'Giant', 'Gnome', 'Goat', 'Goblin', 'God', 'Golem', 'Gorgon', 'Graveborn', 'Gremlin', 'Griffin', 'Hag', 'Harpy', 'Hellion', 'Hippo', 'Hippogriff', 'Homarid', 'Homunculus', 'Horror', 'Horse', 'Hound', 'Human', 'Hydra', 'Hyena', 'Illusion', 'Imp', 'Incarnation', 'Insect', 'Jellyfish', 'Juggernaut', 'Kavu', 'Kirin', 'Kithkin', 'Knight', 'Kobold', 'Kor', 'Kraken', 'Lammasu', 'Leech', 'Leviathan', 'Lhurgoyf', 'Licid', 'Lizard', 'Manticore', 'Masticore', 'Mercenary', 'Merfolk', 'Metathran', 'Minion', 'Minotaur', 'Mole', 'Monger', 'Mongoose', 'Monk', 'Monster', 'Moonfolk', 'Mutant', 'Myr', 'Mystic', 'Nautilus', 'Nephilim', 'Nightmare', 'Nightstalker', 'Ninja', 'Noble', 'Noggle', 'Nomad', 'Nymph', 'Octopus', 'Ogre', 'Ooze', 'Orb', 'Orc', 'Orgg', 'Ouphe', 'Ox', 'Oyster', 'Pangolin', 'Pegasus', 'Pentavite', 'Pest', 'Phelddagrif', 'Phoenix', 'Phyrexian', 'Pilot', 'Pincher', 'Pirate', 'Plant', 'Praetor', 'Prism', 'Processor', 'Rabbit', 'Rat', 'Rebel', 'Reflection', 'Rhino', 'Rigger', 'Rogue', 'Sable', 'Salamander', 'Samurai', 'Sand', 'Saproling', 'Satyr', 'Scarecrow', 'Scion', 'Scorpion', 'Scout', 'Serf', 'Serpent', 'Servo', 'Shade', 'Shaman', 'Shapeshifter', 'Sheep', 'Siren', 'Skeleton', 'Slith', 'Sliver', 'Slug', 'Snake', 'Soldier', 'Soltari', 'Spawn', 'Specter', 'Spellshaper', 'Sphinx', 'Spider', 'Spike', 'Spirit', 'Splinter', 'Sponge', 'Squid', 'Squirrel', 'Starfish', 'Surrakar', 'Survivor', 'Tetravite', 'Thalakos', 'Thopter', 'Thrull', 'Treefolk', 'Trilobite', 'Triskelavite', 'Troll', 'Turtle', 'Unicorn', 'Vampire', 'Vedalken', 'Viashino', 'Volver', 'Wall', 'Warrior', 'Weird', 'Werewolf', 'Whale', 'Wizard', 'Wolf', 'Wolverine', 'Wombat', 'Worm', 'Wraith', 'Wurm', 'Yeti', 'Zombie', 'Zubera'
  ]);

  private readonly mechanicPatterns = new Map([
    ['token', /\b(?:token|create.*token)\b/i],
    ['counter', /\b(?:counter|put.*counter|remove.*counter|\+1\/\+1|\-1\/\-1|loyalty)\b/i],
    ['sacrifice', /\b(?:sacrifice|sac)\b/i],
    ['exile', /\b(?:exile|exiled|exiles)\b/i],
    ['mill', /\b(?:mill|put.*library.*graveyard)\b/i],
    ['scry', /\b(?:scry)\b/i],
    ['draw', /\b(?:draw.*card|draws.*card)\b/i],
    ['discard', /\b(?:discard)\b/i],
    ['life_gain', /\b(?:gain.*life|you gain)\b/i],
    ['life_loss', /\b(?:lose.*life|loses.*life|damage.*player)\b/i],
    ['damage', /\b(?:damage|deal.*damage)\b/i],
    ['enchant', /\b(?:enchant|enchanted)\b/i],
    ['equip', /\b(?:equip|equipped)\b/i],
    ['enter_battlefield', /\b(?:enters.*battlefield|etb)\b/i],
    ['search', /\b(?:search.*library|search.*deck)\b/i],
    ['graveyard', /\b(?:graveyard|from.*graveyard)\b/i],
    ['mana', /\b(?:add.*mana|mana.*pool|\{[WUBRG]\})\b/i],
    ['cost_reduction', /\b(?:cost.*less|costs.*less|reduce.*cost)\b/i]
  ]);

  private readonly triggerPatterns = new Map([
    ['enters_battlefield', /whenever.*enters.*battlefield/i],
    ['dies', /whenever.*dies/i],
    ['attacks', /whenever.*attacks/i],
    ['cast_spell', /whenever.*cast.*spell/i],
    ['draw_card', /whenever.*draw.*card/i],
    ['take_damage', /whenever.*damage/i],
    ['gain_life', /whenever.*gain.*life/i],
    ['beginning_upkeep', /(?:at the )?beginning.*upkeep/i],
    ['end_step', /(?:at the )?(?:beginning.*)?end step/i],
    ['becomes_tapped', /whenever.*becomes tapped/i],
    ['creature_enters', /whenever.*creature enters/i]
  ]);

  private readonly enablerPatterns = new Map([
    ['create_token', /create.*token/i],
    ['add_counter', /put.*counter/i],
    ['add_mana', /add.*\{[WUBRG]\}|add.*mana/i],
    ['deal_damage', /deal.*damage/i],
    ['gain_life', /(?:you )?gain.*life/i],
    ['draw_card', /draw.*card/i],
    ['search_library', /search.*library/i],
    ['return_graveyard', /return.*graveyard.*(?:hand|battlefield)/i],
    ['destroy', /destroy.*(?:creature|artifact|enchantment)/i],
    ['tap_untap', /tap|untap/i]
  ]);

  private readonly keywordAbilities = new Set([
    'Flying', 'First strike', 'Double strike', 'Deathtouch', 'Haste', 'Hexproof', 'Indestructible',
    'Lifelink', 'Menace', 'Reach', 'Trample', 'Vigilance', 'Ward', 'Flash', 'Defender',
    'Shroud', 'Protection', 'Fear', 'Intimidate', 'Shadow', 'Horsemanship', 'Landwalk',
    'Flanking', 'Rampage', 'Banding', 'Bushido', 'Ninjutsu', 'Soulshift', 'Splice',
    'Affinity', 'Convoke', 'Delve', 'Emerge', 'Improvise', 'Offering', 'Undaunted',
    'Bloodthirst', 'Devour', 'Evolve', 'Graft', 'Modular', 'Persist', 'Undying',
    'Wither', 'Infect', 'Toxic', 'Poisonous', 'Annihilator', 'Battle cry', 'Exalted',
    'Extort', 'Populate', 'Scavenge', 'Unleash', 'Cipher', 'Evolve', 'Battalion',
    'Heroic', 'Inspired', 'Constellation', 'Ferocious', 'Formidable', 'Renown',
    'Prowess', 'Megamorph', 'Ingest', 'Devoid', 'Surge', 'Skulk', 'Emerge',
    'Escalate', 'Melee', 'Crew', 'Fabricate', 'Partner', 'Improvise', 'Revolt',
    'Enbalm', 'Eternalize', 'Afflict', 'Rampage', 'Changeling', 'Champion',
    'Evoke', 'Hideaway', 'Prowl', 'Reinforce', 'Conspire', 'Persist', 'Wither',
    'Retrace', 'Devour', 'Exalted', 'Unearth', 'Cascade', 'Annihilator', 'Leveler',
    'Rebound', 'Totem armor', 'Infect', 'Battle cry', 'Living weapon', 'Phyrexian',
    'Miracle', 'Soulbond', 'Overload', 'Scavenge', 'Unleash', 'Cipher', 'Evolve',
    'Fuse', 'Bestow', 'Tribute', 'Dethrone', 'Hidden agenda', 'Outlast', 'Ferocious',
    'Dash', 'Exploit', 'Menace', 'Renown', 'Awaken', 'Devoid', 'Ingest', 'Rally',
    'Cohort', 'Support', 'Surge', 'Skulk', 'Madness', 'Emerge', 'Escalate', 'Melee',
    'Crew', 'Fabricate', 'Partner', 'Undaunted', 'Improvise', 'Revolt', 'Embalm',
    'Eternalize', 'Afflict', 'Enrage', 'Explore', 'Ascend', 'Assist', 'Jump-start',
    'Mentor', 'Afterlife', 'Riot', 'Spectacle', 'Escape', 'Companion', 'Mutate',
    'Cycling', 'Buyback', 'Flashback', 'Madness', 'Morph', 'Suspend', 'Vanishing',
    'Echo', 'Cumulative upkeep', 'Fading', 'Kicker', 'Multikicker', 'Entwine'
  ]);

  /**
   * Extract comprehensive features from a card for graph-based synergy analysis
   */
  extractFeatures(card: ScryfallCard): CardFeatures {
    const text = (card.oracle_text || '').toLowerCase();
    const typeLine = card.type_line || '';
    
    return {
      tribes: this.extractTribes(typeLine),
      mechanics: this.extractMechanics(text),
      triggers: this.extractTriggers(text),
      enablers: this.extractEnablers(text),
      keywords: this.extractKeywordAbilities(card.oracle_text || '', card.keywords || []),
      types: this.extractTypes(typeLine),
      subtypes: this.extractSubtypes(typeLine)
    };
  }

  /**
   * Extract tribal subtypes from type line
   */
  private extractTribes(typeLine: string): Set<string> {
    const tribes = new Set<string>();
    
    // Split by em dash to get subtypes section
    const parts = typeLine.split('—');
    if (parts.length > 1) {
      const subtypes = parts[1].trim().split(' ');
      subtypes.forEach(subtype => {
        const cleanSubtype = subtype.trim();
        if (this.tribalTypes.has(cleanSubtype)) {
          tribes.add(cleanSubtype);
        }
      });
    }
    
    return tribes;
  }

  /**
   * Extract mechanics from card text using pattern matching
   */
  private extractMechanics(text: string): Set<string> {
    const mechanics = new Set<string>();
    
    this.mechanicPatterns.forEach((pattern, mechanic) => {
      if (pattern.test(text)) {
        mechanics.add(mechanic);
      }
    });
    
    return mechanics;
  }

  /**
   * Extract triggered ability patterns
   */
  private extractTriggers(text: string): Set<string> {
    const triggers = new Set<string>();
    
    this.triggerPatterns.forEach((pattern, trigger) => {
      if (pattern.test(text)) {
        triggers.add(trigger);
      }
    });
    
    return triggers;
  }

  /**
   * Extract enabler patterns (things that create effects)
   */
  private extractEnablers(text: string): Set<string> {
    const enablers = new Set<string>();
    
    this.enablerPatterns.forEach((pattern, enabler) => {
      if (pattern.test(text)) {
        enablers.add(enabler);
      }
    });
    
    return enablers;
  }

  /**
   * Extract keyword abilities from oracle text and keywords array
   */
  private extractKeywordAbilities(oracleText: string, keywords: string[]): Set<string> {
    const abilities = new Set<string>();
    
    // Add from keywords array if available
    keywords.forEach(keyword => {
      if (this.keywordAbilities.has(keyword)) {
        abilities.add(keyword);
      }
    });
    
    // Pattern match in oracle text
    this.keywordAbilities.forEach(ability => {
      if (new RegExp(`\\b${ability.toLowerCase()}\\b`, 'i').test(oracleText)) {
        abilities.add(ability);
      }
    });
    
    return abilities;
  }

  /**
   * Extract card types
   */
  private extractTypes(typeLine: string): Set<string> {
    const types = new Set<string>();
    
    const mainTypes = typeLine.split('—')[0].trim().split(' ');
    mainTypes.forEach(type => {
      const cleanType = type.trim();
      if (cleanType && !['Legendary', 'Basic', 'Snow', 'World'].includes(cleanType)) {
        types.add(cleanType);
      }
    });
    
    return types;
  }

  /**
   * Extract all subtypes (not just tribal)
   */
  private extractSubtypes(typeLine: string): Set<string> {
    const subtypes = new Set<string>();
    
    const parts = typeLine.split('—');
    if (parts.length > 1) {
      const subtypeList = parts[1].trim().split(' ');
      subtypeList.forEach(subtype => {
        const cleanSubtype = subtype.trim();
        if (cleanSubtype) {
          subtypes.add(cleanSubtype);
        }
      });
    }
    
    return subtypes;
  }

  /**
   * Check if a card has specific features for synergy matching
   */
  hasFeature(features: CardFeatures, category: keyof CardFeatures, value: string): boolean {
    return features[category].has(value);
  }

  /**
   * Get intersection of features between two cards
   */
  getFeatureIntersection(features1: CardFeatures, features2: CardFeatures, category: keyof CardFeatures): Set<string> {
    const set1 = features1[category];
    const set2 = features2[category];
    return new Set([...set1].filter(x => set2.has(x)));
  }

  /**
   * Check for enabler-trigger complementarity
   */
  hasComplementarity(enablerFeatures: CardFeatures, triggerFeatures: CardFeatures): { score: number; reasons: string[] } {
    const reasons: string[] = [];
    let score = 0;

    // Token synergy: create_token enabler with creature_enters trigger
    if (enablerFeatures.enablers.has('create_token') && triggerFeatures.triggers.has('creature_enters')) {
      score += 4;
      reasons.push('Token creation with creature enters trigger');
    }

    // Counter synergy: add_counter enabler with various triggers
    if (enablerFeatures.enablers.has('add_counter')) {
      if (triggerFeatures.triggers.has('enters_battlefield')) {
        score += 3;
        reasons.push('Counter placement with ETB triggers');
      }
    }

    // Damage synergy
    if (enablerFeatures.enablers.has('deal_damage') && triggerFeatures.triggers.has('take_damage')) {
      score += 3;
      reasons.push('Damage dealing with damage triggers');
    }

    // Life gain synergy
    if (enablerFeatures.enablers.has('gain_life') && triggerFeatures.triggers.has('gain_life')) {
      score += 2;
      reasons.push('Life gain synergy');
    }

    // Mana synergy with card draw
    if (enablerFeatures.enablers.has('add_mana') && triggerFeatures.enablers.has('draw_card')) {
      score += 2;
      reasons.push('Mana acceleration with card draw');
    }

    return { score, reasons };
  }
}

export const keywordExtractionService = new KeywordExtractionService();