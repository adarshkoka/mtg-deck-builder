/**
 * Test script to validate enhanced synergy integration
 */

import type { ScryfallCard } from '../types/scryfall';
import { EnhancedSynergyAnalyzer, EnhancedFeatureExtractor } from './enhancedSynergyService';

// Mock Scryfall cards for testing
const createMockCard = (name: string, oracle_text: string, types?: string[], keywords?: string[]): ScryfallCard => ({
  name,
  oracle_text,
  types: types || [],
  keywords: keywords || [],
  color_identity: ['G', 'W'],
  mana_cost: '{2}{G}{W}',
  set: 'test',
  set_name: 'Test Set',
  id: Math.random().toString(36),
  lang: 'en',
  layout: 'normal',
  highres_image: false,
  image_uris: {
    small: 'https://example.com/small.jpg',
    normal: 'https://example.com/normal.jpg', 
    large: 'https://example.com/large.jpg'
  },
  uri: '',
  scryfall_uri: '',
  cmc: 4,
  type_line: types?.join(' ') || 'Creature',
  power: '2',
  toughness: '2',
  colors: ['G', 'W'],
  legalities: {
    commander: 'legal'
  },
  games: ['paper'],
  reserved: false,
  foil: true,
  nonfoil: true,
  finishes: ['nonfoil'],
  oversized: false,
  promo: false,
  reprint: false,
  variation: false,
  set_id: 'test-set',
  set_uri: '',
  set_search_uri: '',
  scryfall_set_uri: '',
  rulings_uri: '',
  prints_search_uri: '',
  collector_number: '1',
  digital: false,
  rarity: 'common',
  card_back_id: '',
  artist: 'Test Artist',
  artist_ids: ['test-artist'],
  illustration_id: 'test-illustration',
  border_color: 'black',
  frame: '2015',
  security_stamp: 'oval',
  full_art: false,
  textless: false,
  booster: true,
  story_spotlight: false,
  prices: {},
  related_uris: {},
  purchase_uris: {}
} as ScryfallCard);

// Test enhanced synergy analysis
export function testEnhancedSynergyIntegration(): void {
  console.log('🧪 Testing Enhanced Synergy Integration');

  // Test cards with known synergies
  const treasureProducer = createMockCard(
    'Smothering Tithe',
    'Whenever an opponent draws a card, you may pay {2}. If you do, create a Treasure token.',
    ['Enchantment']
  );

  const artifactPayoff = createMockCard(
    'Marionette Master',
    'Fabricate 3. Whenever an artifact you control is put into a graveyard from the battlefield, Marionette Master deals 1 damage to any target.',
    ['Creature', 'Human', 'Artificer']
  );

  const tokenCreator = createMockCard(
    'Avenger of Zendikar', 
    'When Avenger of Zendikar enters, create a 0/1 green Plant creature token for each land you control. Landfall — Whenever a land enters under your control, you may put a +1/+1 counter on each Plant creature you control.',
    ['Creature', 'Elemental']
  );

  const counterPayoff = createMockCard(
    'Hardened Scales',
    'If one or more +1/+1 counters would be put on a creature you control, that many plus one +1/+1 counters are put on it instead.',
    ['Enchantment']
  );

  console.log('\n--- Testing Feature Extraction ---');
  
  const treasureFeatures = EnhancedFeatureExtractor.extractFeatures(treasureProducer);
  console.log('Treasure Producer Features:', treasureFeatures);

  const artifactFeatures = EnhancedFeatureExtractor.extractFeatures(artifactPayoff);
  console.log('Artifact Payoff Features:', artifactFeatures);

  console.log('\n--- Testing Synergy Calculations ---');

  // Test 1: Treasure + Artifact synergy
  const treasureArtifactSynergy = EnhancedSynergyAnalyzer.calculateSynergy(treasureProducer, artifactPayoff);
  console.log('🏴‍☠️ Treasure + Artifact Synergy:', treasureArtifactSynergy);

  // Test 2: Token + Counter synergy  
  const tokenCounterSynergy = EnhancedSynergyAnalyzer.calculateSynergy(tokenCreator, counterPayoff);
  console.log('🪙 Token + Counter Synergy:', tokenCounterSynergy);

  // Test 3: Non-synergistic cards
  const nonSynergy = EnhancedSynergyAnalyzer.calculateSynergy(treasureProducer, counterPayoff);
  console.log('❌ Non-synergy Example:', nonSynergy);

  console.log('\n--- Summary ---');
  console.log('✅ Enhanced synergy integration test completed');
  console.log('Expected: High scores for Treasure+Artifact and Token+Counter pairs');
  console.log('Expected: Low score for Treasure+Counter pair');
}

// Export for potential use in main application
export default testEnhancedSynergyIntegration;