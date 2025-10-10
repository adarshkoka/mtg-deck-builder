import asyncio
import aiohttp
from typing import List, Dict, Optional, Any
from fastapi import HTTPException
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class CardService:
    """Service for fetching MTG card data from Scryfall API"""
    
    def __init__(self):
        self.base_url = "https://api.scryfall.com"
        self.session: Optional[aiohttp.ClientSession] = None
        self.card_cache: Dict[str, Dict] = {}  # Cache for multiverse ID to card data
    
    async def __aenter__(self):
        """Async context manager entry"""
        self.session = aiohttp.ClientSession()
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit"""
        if self.session:
            await self.session.close()
    
    async def get_cards_by_multiverse_ids(self, multiverse_ids: List[int]) -> List[Dict[str, Any]]:
        """
        Fetch card data for a list of multiverse IDs from Scryfall API
        
        Args:
            multiverse_ids: List of multiverse IDs to fetch
            
        Returns:
            List of card data dictionaries
        """
        if not self.session:
            raise HTTPException(status_code=500, detail="Session not initialized")
        
        logger.info(f"Fetching card data for {len(multiverse_ids)} multiverse IDs")
        
        # Filter out any cached cards
        uncached_ids = [mid for mid in multiverse_ids if str(mid) not in self.card_cache]
        
        if uncached_ids:
            await self._fetch_and_cache_cards(uncached_ids)
        
        # Return cached data for all requested IDs
        results = []
        for multiverse_id in multiverse_ids:
            card_data = self.card_cache.get(str(multiverse_id))
            if card_data:
                results.append(card_data)
            else:
                logger.warning(f"Card not found for multiverse ID: {multiverse_id}")
                # Add placeholder for missing card
                results.append({
                    "multiverseId": multiverse_id,
                    "name": "Card Not Found",
                    "oracle_text": "Card data not available",
                    "error": "Card not found in Scryfall database"
                })
        
        return results
    
    async def _fetch_and_cache_cards(self, multiverse_ids: List[int]) -> None:
        """
        Fetch cards from Scryfall API and cache them
        
        Scryfall has individual endpoints for each multiverse ID:
        GET /cards/multiverse/:id
        """
        try:
            # Create semaphore to limit concurrent requests (Scryfall rate limiting)
            semaphore = asyncio.Semaphore(10)  # Limit to 10 concurrent requests
            
            async def fetch_single_card(multiverse_id: int):
                async with semaphore:
                    try:
                        url = f"{self.base_url}/cards/multiverse/{multiverse_id}"
                        logger.info(f"Fetching card data from: {url}")
                        
                        async with self.session.get(url) as response:
                            if response.status == 200:
                                card_data = await response.json()
                                
                                # Transform Scryfall response to our format
                                transformed_card = self._transform_scryfall_card(card_data)
                                self.card_cache[str(multiverse_id)] = transformed_card
                                
                                logger.info(f"Successfully fetched: {transformed_card.get('name')} (multiverse ID: {multiverse_id})")
                                
                            elif response.status == 404:
                                logger.warning(f"Card not found for multiverse ID: {multiverse_id}")
                                # Don't cache 404s, let them be handled as missing cards
                                
                            else:
                                logger.error(f"Failed to fetch card {multiverse_id}: HTTP {response.status}")
                                
                    except Exception as e:
                        logger.error(f"Error fetching card {multiverse_id}: {e}")
            
            # Fetch all cards concurrently
            await asyncio.gather(*[fetch_single_card(mid) for mid in multiverse_ids], return_exceptions=True)
            
            logger.info(f"Cached {len(self.card_cache)} cards")
            
        except Exception as e:
            logger.error(f"Error fetching card data: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to fetch card data: {str(e)}")
    
    def _transform_scryfall_card(self, scryfall_data: Dict) -> Dict[str, Any]:
        """
        Transform Scryfall API response to our internal format
        
        Args:
            scryfall_data: Raw response from Scryfall API
            
        Returns:
            Transformed card data dictionary
        """
        multiverse_ids = scryfall_data.get("multiverse_ids", [])
        multiverse_id = multiverse_ids[0] if multiverse_ids else None
        
        return {
            "multiverseId": multiverse_id,
            "name": scryfall_data.get("name", "Unknown"),
            "oracle_text": scryfall_data.get("oracle_text", ""),  # This is the main card text field
            "mana_cost": scryfall_data.get("mana_cost", ""),
            "cmc": scryfall_data.get("cmc", 0),  # Converted mana cost (now called mana value)
            "type_line": scryfall_data.get("type_line", ""),
            "colors": scryfall_data.get("colors", []),
            "color_identity": scryfall_data.get("color_identity", []),
            "keywords": scryfall_data.get("keywords", []),
            "power": scryfall_data.get("power"),
            "toughness": scryfall_data.get("toughness"),
            "set_code": scryfall_data.get("set", ""),
            "set_name": scryfall_data.get("set_name", ""),
            "rarity": scryfall_data.get("rarity", ""),
            "scryfall_id": scryfall_data.get("id", ""),
            "scryfall_uri": scryfall_data.get("scryfall_uri", ""),
            "image_uris": scryfall_data.get("image_uris", {}),
            "legalities": scryfall_data.get("legalities", {}),
            "released_at": scryfall_data.get("released_at", ""),
            "collector_number": scryfall_data.get("collector_number", ""),
            "artist": scryfall_data.get("artist", ""),
            "prices": scryfall_data.get("prices", {})
        }

# Global service instance
card_service = CardService()