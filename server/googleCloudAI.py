# To run this code you need to install the following dependencies:
# pip install google-genai

import base64
import os
from google import genai
from google.genai import types
from dotenv import load_dotenv

load_dotenv()

def generate(prompt_text: str = None):
    client = genai.Client(
        api_key=os.getenv("GEMINI_API_KEY"),
    )

    model = "gemini-2.5-flash"
    
    # Use provided prompt or default
    text_content = prompt_text if prompt_text else "INSERT_INPUT_HERE"
    
    contents = [
        types.Content(
            role="user",
            parts=[
                types.Part.from_text(text=text_content),
            ],
        ),
    ]
    tools = [
        types.Tool(googleSearch=types.GoogleSearch(
        )),
    ]
    generate_content_config = types.GenerateContentConfig(
        thinking_config = types.ThinkingConfig(
            thinking_budget=5000,
        ),
        tools=tools,
        system_instruction=[
            types.Part.from_text(text="""Be an expert Magic: The Gathering player with a serious knack for card analysis."""),
        ],
    )

    stream = client.models.generate_content(
        model=model,
        contents=contents,
        config=generate_content_config,
    )
    return stream.text

    # for chunk in client.models.generate_content_stream(
    #     model=model,
    #     contents=contents,
    #     config=generate_content_config,
    # ):
    #     print(chunk.text, end="")

if __name__ == "__main__":
    generate()
