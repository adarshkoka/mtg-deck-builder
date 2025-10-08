/**
 * Quick test to validate the regex fix for +1/+1 counters
 */

import { EnhancedFeatureExtractor } from './enhancedSynergyService';

// Test the regex fix
console.log('🧪 Testing regex fix for +1/+1 counters...');

const testCard = {
  name: 'Test Card',
  oracle_text: 'When this enters, put a +1/+1 counter on target creature.',
  mana_cost: '{2}{G}',
  type_line: 'Creature',
  // Add minimal required properties
} as any;

try {
  const features = EnhancedFeatureExtractor.extractFeatures(testCard);
  console.log('✅ Regex fix successful!');
  console.log('Extracted features:', features);
  
  if (features.counterTypes.includes('+1/+1')) {
    console.log('✅ +1/+1 counter detection working correctly');
  } else {
    console.log('⚠️ +1/+1 counter not detected - check pattern matching');
  }
} catch (error) {
  console.error('❌ Regex fix failed:', error);
}

export default () => console.log('Regex test module loaded');