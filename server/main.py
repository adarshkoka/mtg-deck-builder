from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Any
from card_service import card_service
from googleCloudAI import generate
import logging
import asyncio

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="MTG Card API", description="API for fetching MTG card data", version="1.0.0")

# Add CORS middleware to allow frontend requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],  # Vite dev server
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

class CardResponse(BaseModel):
    cards: List[Dict[str, Any]]
    total_requested: int
    total_found: int

class AnalysisResponse(BaseModel):
    cards: List[Dict[str, Any]]
    formatted_prompt: str
    ai_analysis: str
    total_requested: int
    total_found: int

@app.get("/")
async def root():
    return {"message": "MTG Card API", "version": "1.0.0"}

@app.get("/health")
async def health_check():
    return {"status": "healthy"}

@app.get("/analyzeCards", response_model=AnalysisResponse)
async def analyze_cards_with_ai(multiverse_ids: str = Query(..., description="Comma-separated list of multiverse IDs to analyze")):
    """
    Fetch card data and analyze it using Google Cloud AI
    
    Args:
        multiverse_ids: Comma-separated string of multiverse IDs (e.g., "1234,5678,9012")
        
    Returns:
        AnalysisResponse with card data, formatted prompt, AI analysis, and metadata
    """
    # Parse comma-separated string into list of integers
    try:
        id_list = [int(id_str.strip()) for id_str in multiverse_ids.split(",") if id_str.strip()]
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid multiverse ID format. Please provide comma-separated integers: {str(e)}")
    
    if not id_list:
        raise HTTPException(status_code=400, detail="multiverse_ids list cannot be empty")
    
    if len(id_list) > 20:  # Limit for AI analysis to prevent too long prompts
        raise HTTPException(status_code=400, detail="Maximum 20 multiverse IDs allowed for AI analysis")
    
    logger.info(f"Received AI analysis request for {len(id_list)} cards")
    
    try:
        # Fetch card data
        async with card_service as service:
            cards = await service.get_cards_by_multiverse_ids(id_list)
            
            # Count cards that were actually found
            found_cards = [card for card in cards if "error" not in card]
            found_count = len(found_cards)
            
            if found_count == 0:
                raise HTTPException(status_code=404, detail="No valid cards found for the provided multiverse IDs")
            
            # Create formatted prompt
            formatted_prompt = _create_card_analysis_prompt(found_cards)
            
            # Get AI analysis
            try:
                ai_analysis = generate(formatted_prompt)
            except Exception as e:
                logger.error(f"AI analysis failed: {e}")
                raise HTTPException(status_code=500, detail=f"AI analysis failed: {str(e)}")
            
            return AnalysisResponse(
                cards=cards,
                formatted_prompt=formatted_prompt,
                ai_analysis=ai_analysis,
                total_requested=len(id_list),
                total_found=found_count
            )
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error processing AI analysis request: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

def _create_card_analysis_prompt(cards: List[Dict[str, Any]]) -> str:
    """
    Create a nicely formatted prompt for AI analysis
    
    Args:
        cards: List of card data dictionaries
        
    Returns:
        Formatted prompt string for AI analysis
    """
    prompt_parts = [
        "Please analyze the following Magic: The Gathering cards and provide insights about their synergies, strategies, and potential deck themes:\n\n"
    ]
    
    for i, card in enumerate(cards, 1):
        card_section = f"Card {i}:\n"
        card_section += f"Name: {card.get('name', 'Unknown')}\n"
        card_section += f"Mana Cost: {card.get('mana_cost', 'N/A')}\n"
        card_section += f"Type: {card.get('type_line', 'Unknown')}\n"
        
        oracle_text = card.get('oracle_text', '')
        if oracle_text:
            card_section += f"Card Text: {oracle_text}\n"
        else:
            card_section += "Card Text: No text available\n"
        
        # Add power/toughness for creatures
        power = card.get('power')
        toughness = card.get('toughness')
        if power is not None and toughness is not None:
            card_section += f"Power/Toughness: {power}/{toughness}\n"
        
        card_section += "\n"
        prompt_parts.append(card_section)
    
    prompt_parts.append(
        "Based on these cards, please provide:\n"
        "1. Synergies between the cards\n"
        "2. Potential deck strategies or themes\n"
        "3. Strengths and weaknesses of this card combination\n"
        "4. Suggestions for complementary cards or strategies\n"
        "5. Overall assessment of the cards' competitive viability"
    )
    
    return "".join(prompt_parts)

@app.get("/getCards", response_model=CardResponse)
async def get_cards_by_multiverse_ids(multiverse_ids: str = Query(..., description="Comma-separated list of multiverse IDs to fetch")):
    """
    Fetch card data for a list of multiverse IDs
    
    Args:
        multiverse_ids: Comma-separated string of multiverse IDs (e.g., "1234,5678,9012")
        
    Returns:
        CardResponse with card data, total requested, and total found
    """
    # Parse comma-separated string into list of integers
    try:
        # Split by comma, strip whitespace, and convert to integers
        id_list = [int(id_str.strip()) for id_str in multiverse_ids.split(",") if id_str.strip()]
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid multiverse ID format. Please provide comma-separated integers: {str(e)}")
    
    if not id_list:
        raise HTTPException(status_code=400, detail="multiverse_ids list cannot be empty")
    
    if len(id_list) > 100:
        raise HTTPException(status_code=400, detail="Maximum 100 multiverse IDs allowed per request")
    
    logger.info(f"Received request for {len(id_list)} cards")
    
    try:
        async with card_service as service:
            cards = await service.get_cards_by_multiverse_ids(id_list)
            
            # Count cards that were actually found (not error placeholders)
            found_count = sum(1 for card in cards if "error" not in card)
            
            return CardResponse(
                cards=cards,
                total_requested=len(id_list),
                total_found=found_count
            )
    
    except Exception as e:
        logger.error(f"Error processing request: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)