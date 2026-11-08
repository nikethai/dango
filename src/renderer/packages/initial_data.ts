import { migrateMessage } from '@/utils/message'
import { ModelProviderEnum, type Session } from '../../shared/types'

export const defaultSessionsForEN: Session[] = [
  {
    id: 'justchat-b612-406a-985b-3ab4d2c482ff',
    name: 'Just chat',
    type: 'chat',
    messages: [
      {
        id: 'a700be6c-cbdd-43a3-b572-49e7a921c059',
        role: 'system' as const,
        content: 'You are a helpful assistant.',
      },
    ].map(migrateMessage),
    starred: true,
  },
  {
    id: '6dafa15e-c72f-4036-ac89-33c09e875bdc',
    name: 'Markdown 101 (Example)',
    type: 'chat',
    starred: true,
    messages: [
      {
        id: '83240028-9d8b-43f2-87f2-a0a2be4dbf08',
        role: 'system' as const,
        content: 'You are a helpful assistant.',
      },
      {
        id: '430a7c50-39be-4aa4-965b-2bc56383c6cf',
        content: 'Write a demo table in markdown',
        role: 'user' as const,
      },
      {
        id: '899ff59b-cb8f-4b7c-aed0-26e082aed141',
        content:
          'Sure, here\'s a demo table in markdown:\n\n| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n| Row 1, Column 1 | Row 1, Column 2 | Row 1, Column 3 |\n| Row 2, Column 1 | Row 2, Column 2 | Row 2, Column 3 |\n| Row 3, Column 1 | Row 3, Column 2 | Row 3, Column 3 | \n\nIn this table, there are three columns labeled "Column 1", "Column 2", and "Column 3". There are also three rows, each with a value in each column. The "---" used in the second row is markdown syntax for a separator between the header row and the data rows.',
        role: 'assistant' as const,
        model: 'unknown',
        generating: false,
      },
      {
        id: '2ec392ba-7aaf-48fb-adb7-8a878a3cd843',
        content: 'What is the formula for Fourier Transform? Using KaTeX syntax.',
        role: 'user' as const,
      },
      {
        id: 'fa204c2f-6138-4d3d-a132-a77b345587f5',
        content:
          'The formula for Fourier Transform is:\n\n$$\n\\hat{f}(\\xi) = \\int_{-\\infty}^{\\infty} f(x)\\, e^{-2\\pi ix\\xi} \\,dx\n$$\n\nwhere $\\hat{f}(\\xi)$ denotes the Fourier transform of $f(x)$.',
        role: 'assistant' as const,
        model: 'unknown',
        generating: false,
      },
    ].map(migrateMessage),
  },
  {
    id: 'e22ab364-4681-4e24-aaba-461ed0fccfd3',
    name: 'Travel guide (example)',
    type: 'chat',
    picUrl: 'https://static.chatboxai.app/copilot-avatar/travel.png',
    messages: [
      {
        id: 'a639e972-10b7-4a67-8f3d-bf46e1e94c68',
        role: 'system' as const,
        content:
          'I want you to act as a travel guide. I will write you my location and you will suggest a place to visit near my location. In some cases, I will also give you the type of places I will visit. You will also suggest me places of similar type that are close to my first location.',
      },
      {
        id: '58cdc275-8d7a-4d64-85ca-bb026716b9b2',
        content: 'Give me a 7-day travel itinerary for Japan',
        role: 'user' as const,
      },
      {
        id: 'e8d02e3d-46cd-4519-bb78-30995ea48068',
        content:
          "Sure, here's a 7-day itinerary for exploring Japan:\n\nDay 1: Tokyo\n- Visit Sensoji Temple in Asakusa\n- Explore the trendy neighborhood of Shibuya\n- See the iconic Tokyo Tower\n\nDay 2: Tokyo\n- Visit the famous Tsukiji Fish Market\n- Experience Japan's technology at the Sony showroom\n- Take a stroll through the Imperial Palace Gardens\n\nDay 3: Hakone\n- Enjoy a scenic train ride to Hakone\n- Take a cable car up to the Owakudani Valley\n- Relax in a hot spring at an onsen resort\n\nDay 4: Kyoto\n- Explore the old streets of Gion district\n- Visit the impressive Fushimi-Inari Shrine\n- Marvel at the Golden Pavilion Temple\n\nDay 5: Kyoto\n- Take a stroll through the Arashiyama Bamboo Forest\n- Visit the Ryoanji Temple and its Zen garden\n- Explore the Nishiki Market for some authentic Japanese cuisine \n\nDay 6: Hiroshima\n- Visit the Atomic Bomb Dome and Peace Memorial Park\n- Take a ferry to Miyajima Island to see the Itsukushima Shrine and friendly deer\n\nDay 7: Osaka\n- Eat your way through the famous food streets of Dotonbori\n- Visit the Osaka Castle\n- Enjoy the nightlife in the trendy neighborhood of Namba.\n\nI hope you enjoy your trip to Japan!",
        role: 'assistant' as const,
        model: 'unknown',
        generating: false,
      },
    ].map(migrateMessage),
    starred: false,
    copilotId: 'chatbox-featured:24',
  },
  {
    id: '55d92e88-02af-4c3b-a378-aa0a1970abb1',
    name: 'Social media influencer (example)',
    type: 'chat',
    picUrl: 'https://static.chatboxai.app/copilot-avatar/twitter.png',
    messages: [
      {
        id: 'f8f341f4-9a13-448d-becd-b8d07c31f8dd',
        role: 'system' as const,
        content:
          'I want you to act as a social media influencer. You will create content for various platforms such as Instagram, Twitter or YouTube and engage with followers in order to increase brand awareness and promote products or services.',
      },
      {
        id: 'e99f80e0-b5a4-4a4d-954e-9ad20c8465e7',
        content: 'Tweet out to let everyone know: The latest version of Dango has been released',
        role: 'user' as const,
      },
      {
        id: 'eb6218ad-439d-4e15-847b-0382f844f96e',
        content:
          '"Exciting news! The latest version of Dango has just been released. Get ready to experience amazing features and seamless AI conversations. Upgrade now and unleash your productivity potential! #Dango #AI #Upgrade"',
        role: 'assistant' as const,
        model: 'unknown',
        generating: false,
      },
    ].map(migrateMessage),
    starred: false,
    copilotId: 'chatbox-featured:33',
  },
  {
    id: '35df5a96-b612-406a-985b-3ab4d2c481ff',
    name: 'Software developer (example)',
    type: 'chat',
    picUrl: 'https://static.chatboxai.app/copilot-avatar/programmer.png',
    messages: [
      {
        id: 'a700be6c-cbdd-43a3-b572-49e7a921c059',
        role: 'system' as const,
        content:
          'I want you to act as a software developer. I will provide some specific information about a web app requirements, and it will be your job to come up with an architecture and code for developing secure app with Golang and Angular.',
      },
      {
        id: '844ab486-cd18-47b3-a560-27389178df80',
        content: 'Write a Python function to encode the input text in base64.',
        role: 'user' as const,
      },
      {
        id: '3c5b4b84-d258-4143-af28-bab29d280d8b',
        content:
          "Sure, here's an example Python function to encode a string in base64:\n\n```python\nimport base64\n\ndef encode_base64(text):\n    encoded = base64.b64encode(text.encode('utf-8'))\n    return encoded.decode('utf-8')\n```\n\nYou can call this function with a string as an argument, and it will return the base64-encoded version of the string:\n\n```python\ntext = \"Hello, world!\"\nencoded_text = encode_base64(text)\nprint(encoded_text)\n```\n\nOutput:\n```\nSGVsbG8sIHdvcmxkIQ==\n```\n\nNote that we first convert the string to bytes using the `encode()` method, and then pass that to the `b64encode()` method in the `base64` module. We also decode the result back to a string using `decode()` method.",
        role: 'assistant' as const,
        model: 'unknown',
        generating: false,
      },
    ].map(migrateMessage),
    starred: true,
    copilotId: 'chatbox-featured:35',
  },
  {
    id: '776eac23-7b4a-40da-91cd-f233bb4742ed',
    name: 'Translator (Example)',
    type: 'chat',
    picUrl: 'https://static.chatboxai.app/copilot-avatar/translator.jpeg',
    messages: [
      {
        id: '4f609d56-5e6a-40b7-8e32-7b3ba8a9a990',
        role: 'system' as const,
        content:
          'I want you to act as an English translator, spelling corrector and improver. I will speak to you in any language and you will detect the language, translate it and answer in the corrected and improved version of my text, in English. I want you to replace my simplified A0-level words and sentences with more beautiful and elegant, upper level English words and sentences. Keep the meaning same, but make them more literary. I want you to only reply the correction, the improvements and nothing else, do not write explanations.',
      },
      {
        id: '4188b8ca-f549-4f51-99b9-9e06c8d00566',
        content: 'Bonjour, ravi de vous rencontrer',
        role: 'user' as const,
      },
      {
        id: '67435839-0d47-496f-8f73-a82c0c3db5d1',
        content: 'Hello, it is a pleasure to meet you.',
        role: 'assistant' as const,
        model: 'unknown',
        generating: false,
      },
      {
        id: 'ae2618e8-ee72-43d5-ba81-1f1d41b8ae8a',
        content: 'おはようございます',
        role: 'user' as const,
      },
      {
        id: 'd74098a2-7745-44e2-a284-c3844955004a',
        content: 'Good morning.',
        role: 'assistant' as const,
        model: 'unknown',
        generating: false,
      },
      {
        id: '765a4a39-7716-4d32-9ae2-da099c91e0db',
        content: 'Les premiers seront les derniers',
        role: 'user' as const,
      },
      {
        id: 'e1168e40-a26b-4a0c-ab84-cfd5d32c2b6f',
        content: 'The first shall be last.',
        role: 'assistant' as const,
        model: 'unknown',
        generating: false,
      },
      {
        id: 'e47a0485-365d-45de-a5ba-e16b29ea1023',
        content: 'Cogito, ergo sum',
        role: 'user' as const,
      },
      {
        id: '565164bc-5d1d-4cee-a1fd-2dfbfb3f5181',
        content: 'I think, therefore I am.',
        role: 'assistant' as const,
        model: 'unknown',
        generating: false,
      },
    ].map(migrateMessage),
    starred: false,
    copilotId: 'chatbox-featured:56',
  },
]

/** Session IDs of retired Chinese-only demo seeds (kept for migration cleanup). */
export const retiredChineseDemoSessionIds: string[] = [
  '81cfc426-48b4-4a13-ad42-bfcfc4544299',
  '8732ec08-b23c-4b5e-8f65-d63d808f970f',
  '3e091ac6-ebfa-42c9-b125-c67ac2d45ee1',
  'chatbox-chat-demo-artifact-1-cn',
  'mermaid-demo-1-cn',
]

/** English-only product: CN seed list matches EN (no Chinese demo content). */
export const defaultSessionsForCN: Session[] = defaultSessionsForEN

export const imageCreatorSessionForEN: Session = {
  id: 'chatbox-chat-demo-image-creator',
  name: 'Image creator (example)',
  type: 'picture',
  starred: true,
  settings: {
    dalleStyle: 'vivid',
    provider: ModelProviderEnum.OpenAI,
    modelId: 'DALL-E-3',
  },
  messages: [
    {
      id: 'chatbox-chat-demo-image-creator-message-id-1',
      role: 'system' as const,
      content: `Hi! I'm Dango Image Creator, your artistic AI companion dedicated to converting your words into striking visuals. If you can dream it, I can create it—from enchanting landscapes, dynamic characters, app icons to the abstract and beyond.

I'm a quiet robot, just **simply tell me the description of the image you have in mind**, and I'll focus all my pixels into crafting your vision.

Let's make art!`,
    },
    {
      id: 'chatbox-chat-demo-image-creator-message-id-2',
      role: 'user' as const,
      content: 'A mermaid-themed greeting card.',
    },
    {
      id: 'chatbox-chat-demo-image-creator-message-id-3',
      role: 'assistant' as const,
      content: '',
      pictures: [
        { url: 'https://download.chatboxai.app/image-demo/card1.png' },
        { url: 'https://download.chatboxai.app/image-demo/card2.png' },
        { url: 'https://download.chatboxai.app/image-demo/card3.png' },
      ],
    },
    {
      id: 'chatbox-chat-demo-image-creator-message-id-4',
      role: 'user' as const,
      content: 'A movie poster of the Titanic in space.',
    },
    {
      id: 'chatbox-chat-demo-image-creator-message-id-5',
      role: 'assistant' as const,
      content: '',
      pictures: [
        { url: 'https://download.chatboxai.app/image-demo/movie1.png' },
        { url: 'https://download.chatboxai.app/image-demo/movie2.png' },
        { url: 'https://download.chatboxai.app/image-demo/movie3.png' },
      ],
    },
    {
      id: 'chatbox-chat-demo-image-creator-message-id-6',
      role: 'user' as const,
      content: 'Comic strip of a superhero who loves eating apples battling an evil doctor.',
    },
    {
      id: 'chatbox-chat-demo-image-creator-message-id-7',
      role: 'assistant' as const,
      content: '',
      pictures: [
        { url: 'https://download.chatboxai.app/image-demo/comic1.png' },
        { url: 'https://download.chatboxai.app/image-demo/comic2.png' },
        { url: 'https://download.chatboxai.app/image-demo/comic3.png' },
      ],
    },
    {
      id: 'chatbox-chat-demo-image-creator-message-id-8',
      role: 'user' as const,
      content: 'Icon for a chat app',
    },
    {
      id: 'chatbox-chat-demo-image-creator-message-id-9',
      role: 'assistant' as const,
      content: '',
      pictures: [
        { url: 'https://download.chatboxai.app/image-demo/app1.png' },
        { url: 'https://download.chatboxai.app/image-demo/app2.png' },
        { url: 'https://download.chatboxai.app/image-demo/app3.png' },
      ],
    },
    {
      id: 'chatbox-chat-demo-image-creator-message-id-10',
      role: 'user' as const,
      content: 'A girl in the city of night, Japanese anime, cyberpunk style.',
    },
    {
      id: 'chatbox-chat-demo-image-creator-message-id-11',
      role: 'assistant' as const,
      content: '',
      pictures: [
        { url: 'https://download.chatboxai.app/image-demo/girl1.png' },
        { url: 'https://download.chatboxai.app/image-demo/girl2.png' },
        { url: 'https://download.chatboxai.app/image-demo/girl3.png' },
      ],
    },
    {
      id: 'chatbox-chat-demo-image-creator-message-id-12',
      role: 'user' as const,
      content: 'A cute cartoon kitty.',
    },
    {
      id: 'chatbox-chat-demo-image-creator-message-id-13',
      role: 'assistant' as const,
      content: '',
      pictures: [
        { url: 'https://download.chatboxai.app/image-demo/cat1.png' },
        { url: 'https://download.chatboxai.app/image-demo/cat2.png' },
        { url: 'https://download.chatboxai.app/image-demo/cat3.png' },
      ],
    },
  ].map(migrateMessage),
}

export const artifactSessionEN: Session = {
  id: 'chatbox-chat-demo-artifact-1-en',
  name: 'Snake game (artifact example)',
  type: 'chat',
  picUrl: 'https://download.chatboxai.app/image-demo/snake_game.png',
  messages: [
    {
      id: '0104fabe-564a-4b99-b9e3-24c34a6805b2',
      role: 'system' as const,
      content:
        'You are a skilled developer proficient in HTML/JS/CSS/TailwindCSS. Please use these technologies to create the page I need.',
      wordCount: 21,
      tokenCount: 35,
      timestamp: 1721205396827,
    },
    {
      id: 'e2703f79-ed98-403b-adeb-6c74425607de',
      content: 'Write a Snake game',
      role: 'user' as const,
      timestamp: 1721205559391,
      wordCount: 8,
      tokenCount: 19,
    },
    {
      id: 'ef9f09f1-5096-43c6-b726-e5f32649435d',
      content:
        'Sure, I can help you write a simple Snake game. Here\'s the complete HTML, CSS, and JavaScript code:\n\n```html\n<!DOCTYPE html>\n<html lang="en">\n<head>\n    <meta charset="UTF-8">\n    <meta name="viewport" content="width=device-width, initial-scale=1.0">\n    <title>Snake Game</title>\n    <style>\n        #gameCanvas {\n            border: 1px solid black;\n        }\n    </style>\n</head>\n<body>\n    <canvas id="gameCanvas" width="400" height="400"></canvas>\n    <script>\n        const canvas = document.getElementById(\'gameCanvas\');\n        const ctx = canvas.getContext(\'2d\');\n\n        const gridSize = 20;\n        const tileCount = canvas.width / gridSize;\n\n        let snake = [\n            {x: 10, y: 10},\n        ];\n        let food = {x: 15, y: 15};\n        let dx = 0;\n        let dy = 0;\n\n        function drawGame() {\n            clearCanvas();\n            moveSnake();\n            drawSnake();\n            drawFood();\n            checkCollision();\n            setTimeout(drawGame, 100);\n        }\n\n        function clearCanvas() {\n            ctx.fillStyle = \'white\';\n            ctx.fillRect(0, 0, canvas.width, canvas.height);\n        }\n\n        function moveSnake() {\n            const head = {x: snake[0].x + dx, y: snake[0].y + dy};\n            snake.unshift(head);\n\n            if (head.x === food.x && head.y === food.y) {\n                generateFood();\n            } else {\n                snake.pop();\n            }\n        }\n\n        function drawSnake() {\n            ctx.fillStyle = \'green\';\n            snake.forEach(segment => {\n                ctx.fillRect(segment.x * gridSize, segment.y * gridSize, gridSize - 2, gridSize - 2);\n            });\n        }\n\n        function drawFood() {\n            ctx.fillStyle = \'red\';\n            ctx.fillRect(food.x * gridSize, food.y * gridSize, gridSize - 2, gridSize - 2);\n        }\n\n        function generateFood() {\n            food.x = Math.floor(Math.random() * tileCount);\n            food.y = Math.floor(Math.random() * tileCount);\n        }\n\n        function checkCollision() {\n            const head = snake[0];\n\n            if (head.x < 0 || head.x >= tileCount || head.y < 0 || head.y >= tileCount) {\n                resetGame();\n            }\n\n            for (let i = 1; i < snake.length; i++) {\n                if (head.x === snake[i].x && head.y === snake[i].y) {\n                    resetGame();\n                }\n            }\n        }\n\n        function resetGame() {\n            snake = [{x: 10, y: 10}];\n            food = {x: 15, y: 15};\n            dx = 0;\n            dy = 0;\n        }\n\n        document.addEventListener(\'keydown\', changeDirection);\n\n        function changeDirection(event) {\n            const LEFT_KEY = 37;\n            const RIGHT_KEY = 39;\n            const UP_KEY = 38;\n            const DOWN_KEY = 40;\n\n            const keyPressed = event.keyCode;\n\n            const goingUp = dy === -1;\n            const goingDown = dy === 1;\n            const goingRight = dx === 1;\n            const goingLeft = dx === -1;\n\n            if (keyPressed === LEFT_KEY && !goingRight) {\n                dx = -1;\n                dy = 0;\n            }\n\n            if (keyPressed === UP_KEY && !goingDown) {\n                dx = 0;\n                dy = -1;\n            }\n\n            if (keyPressed === RIGHT_KEY && !goingLeft) {\n                dx = 1;\n                dy = 0;\n            }\n\n            if (keyPressed === DOWN_KEY && !goingUp) {\n                dx = 0;\n                dy = 1;\n            }\n        }\n\n        drawGame();\n    </script>\n</body>\n</html>\n```\n\nThis Snake game includes the following features:\n\n1. Uses Canvas to draw the game interface.\n2. The snake can move and eat food.\n3. Food is generated randomly.\n4. The game resets when the snake hits a wall or itself.\n5. Use the arrow keys to control the movement of the snake.\n\nYou can save this code as an HTML file and open it in a browser to play the game. Use the arrow keys to control the direction of the snake\'s movement.\n\nIf you want to further improve this game, consider adding the following features:\n\n1. Scoring system.\n2. Game start and end screens.\n3. Difficulty selection (by adjusting the speed of the snake).\n4. Sound effects.\n5. Better visual effects (such as gradients, images, etc.).\n\nHope this example helps! If you have any questions or need further explanation, feel free to ask me.',
      role: 'assistant' as const,
      timestamp: 1721042681817,
      generating: false,
      wordCount: 559,
      tokenCount: 1119,
      aiProvider: 'openai' as any,
      model: 'GPT-4o',
      status: [],
      tokensUsed: 1165,
    },
    {
      id: 'a2c3edf2-3771-42bf-bd62-dfca2b9fcd65',
      content:
        'Please make the following improvements:\n\n1. Add directional buttons so the game can be played on touchscreen phones.\n2. Add a scoring system.\n3. Add "Start Game" and "Restart Game" buttons.\n4. Redesign the UI style.\n',
      role: 'user' as const,
      timestamp: 1721206033930,
      wordCount: 55,
      tokenCount: 72,
    },
    {
      id: '5096fc82-1463-4890-8a4f-8cef6c2344ab',
      content:
        'Sure, I can help you improve the UI. Here\'s an updated version with some visual effects and game controls:\n\n```html\n<!DOCTYPE html>\n<html lang="en">\n\n<head>\n    <meta charset="UTF-8">\n    <meta name="viewport" content="width=device-width, initial-scale=1.0">\n    <title>Snake Game</title>\n    <style>\n        body {\n            display: flex;\n            justify-content: center;\n            align-items: center;\n            height: 100vh;\n            margin: 0;\n            background-color: #f0f0f0;\n            font-family: Arial, sans-serif;\n        }\n\n        .game-container {\n            text-align: center;\n            display: flex;\n            align-items: center;\n            justify-content: space-between;\n            max-width: 100%;\n            flex-wrap: wrap;\n        }\n\n        #gameCanvas {\n            border: 2px solid #333;\n            border-radius: 5px;\n            box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);\n            margin: 0 auto;\n        }\n\n        #gameControls {\n            text-align: center;\n            margin: 0 auto;\n            padding: 0 8px;\n        }\n\n        #gameScore {\n            display: flex;\n            flex-direction: column;\n            align-items: center;\n            justify-content: center;\n        }\n\n        #score {\n            font-size: 24px;\n            margin: 10px 0;\n        }\n\n        #startBtn {\n            font-size: 18px;\n            padding: 12px 24px;\n            background: linear-gradient(145deg, #f0f0f0, #cacaca);\n            color: #333;\n            border: none;\n            border-radius: 10px;\n            cursor: pointer;\n            transition: all 0.3s ease;\n            box-shadow: 5px 5px 10px #bebebe,\n                -5px -5px 10px #ffffff;\n            position: relative;\n            overflow: hidden;\n            font-weight: bold;\n            text-transform: uppercase;\n            letter-spacing: 1px;\n        }\n\n        #startBtn::before {\n            content: \'\';\n            position: absolute;\n            top: 2px;\n            left: 2px;\n            right: 2px;\n            bottom: 50%;\n            background: linear-gradient(180deg, rgba(255, 255, 255, 0.3), transparent);\n            border-radius: 8px 8px 0 0;\n            pointer-events: none;\n        }\n\n        #startBtn:hover {\n            transform: translateY(-2px);\n            box-shadow: 6px 6px 12px #bebebe,\n                -6px -6px 12px #ffffff;\n            background: linear-gradient(145deg, #f5f5f5, #d0d0d0);\n        }\n\n        #startBtn:active {\n            transform: translateY(1px);\n            box-shadow: inset 4px 4px 8px #bebebe,\n                inset -4px -4px 8px #ffffff;\n            background: linear-gradient(145deg, #e6e6e6, #c0c0c0);\n        }\n\n        .controls {\n            display: grid;\n            grid-template-columns: repeat(3, 1fr);\n            gap: 10px;\n            width: 180px;\n            margin: 20px auto;\n        }\n\n        .control-btn {\n            width: 60px;\n            height: 60px;\n            font-size: 24px;\n            background: linear-gradient(145deg, #f0f0f0, #cacaca);\n            color: #333;\n            border: none;\n            border-radius: 50%;\n            cursor: pointer;\n            transition: all 0.3s ease;\n            display: flex;\n            justify-content: center;\n            align-items: center;\n            box-shadow: 5px 5px 10px #bebebe,\n                -5px -5px 10px #ffffff;\n            position: relative;\n            overflow: hidden;\n        }\n\n        .control-btn::before {\n            content: \'\';\n            position: absolute;\n            top: 5%;\n            left: 5%;\n            right: 5%;\n            bottom: 5%;\n            border-radius: 50%;\n            z-index: -1;\n        }\n\n        .control-btn:hover {\n            transform: translateY(-2px);\n            box-shadow: 6px 6px 12px #bebebe,\n                -6px -6px 12px #ffffff;\n        }\n\n        .control-btn:active {\n            transform: translateY(1px);\n            box-shadow: inset 4px 4px 8px #bebebe,\n                inset -4px -4px 8px #ffffff;\n        }\n\n        #up {\n            grid-column: 2;\n        }\n\n        #left {\n            grid-column: 1;\n            grid-row: 2;\n        }\n\n        #right {\n            grid-column: 3;\n            grid-row: 2;\n        }\n\n        #down {\n            grid-column: 2;\n            grid-row: 3;\n        }\n    </style>\n</head>\n\n<body>\n    <div class="game-container">\n        <canvas id="gameCanvas" width="300" height="300"></canvas>\n        <div id="gameControls">\n            <div id="gameScore">\n                <div id="score">Score: 0</div>\n                <button id="startBtn">Start</button>\n            </div>\n            <div class="controls">\n                <button id="up" class="control-btn" onclick="changeDirectionByButton(\'up\')">↑</button>\n                <button id="left" class="control-btn" onclick="changeDirectionByButton(\'left\')">←</button>\n                <button id="right" class="control-btn" onclick="changeDirectionByButton(\'right\')">→</button>\n                <button id="down" class="control-btn" onclick="changeDirectionByButton(\'down\')">↓</button>\n            </div>\n        </div>\n    </div>\n    <script>\n        const canvas = document.getElementById(\'gameCanvas\');\n        const ctx = canvas.getContext(\'2d\');\n        const scoreElement = document.getElementById(\'score\');\n        const startBtn = document.getElementById(\'startBtn\');\n\n        const gridSize = 15;\n        const tileCount = canvas.width / gridSize;\n\n        let snake = [{ x: 10, y: 10 }];\n        let food = { x: 15, y: 15 };\n        let dx = 0;\n        let dy = 0;\n        let score = 0;\n        let gameRunning = false;\n\n        function drawGame() {\n            if (!gameRunning) return;\n\n            clearCanvas();\n            moveSnake();\n            drawSnake();\n            drawFood();\n            checkCollision();\n            updateScore();\n            setTimeout(drawGame, 200);\n        }\n\n        function clearCanvas() {\n            ctx.fillStyle = \'#f0f0f0\';\n            ctx.fillRect(0, 0, canvas.width, canvas.height);\n        }\n\n        function moveSnake() {\n            const head = { x: snake[0].x + dx, y: snake[0].y + dy };\n            snake.unshift(head);\n\n            if (head.x === food.x && head.y === food.y) {\n                generateFood();\n                score += 10;\n            } else {\n                snake.pop();\n            }\n        }\n\n        function drawSnake() {\n            snake.forEach((segment, index) => {\n                const gradient = ctx.createLinearGradient(\n                    segment.x * gridSize,\n                    segment.y * gridSize,\n                    (segment.x + 1) * gridSize,\n                    (segment.y + 1) * gridSize\n                );\n                gradient.addColorStop(0, \'#4CAF50\');\n                gradient.addColorStop(1, \'#45a049\');\n                ctx.fillStyle = gradient;\n                ctx.fillRect(segment.x * gridSize, segment.y * gridSize, gridSize - 2, gridSize - 2);\n\n                if (index === 0) {\n                    // Draw eyes\n                    ctx.fillStyle = \'white\';\n                    ctx.beginPath();\n                    ctx.arc(segment.x * gridSize + 5, segment.y * gridSize + 5, 2, 0, 2 * Math.PI);\n                    ctx.arc(segment.x * gridSize + 10, segment.y * gridSize + 5, 2, 0, 2 * Math.PI);\n                    ctx.fill();\n                }\n            });\n        }\n\n        function drawFood() {\n            const gradient = ctx.createRadialGradient(\n                food.x * gridSize + gridSize / 2,\n                food.y * gridSize + gridSize / 2,\n                2,\n                food.x * gridSize + gridSize / 2,\n                food.y * gridSize + gridSize / 2,\n                gridSize / 2\n            );\n            gradient.addColorStop(0, \'#ff6b6b\');\n            gradient.addColorStop(1, \'#ee5253\');\n            ctx.fillStyle = gradient;\n            ctx.beginPath();\n            ctx.arc(food.x * gridSize + gridSize / 2, food.y * gridSize + gridSize / 2, gridSize / 2 - 1, 0, 2 * Math.PI);\n            ctx.fill();\n        }\n\n        function generateFood() {\n            food.x = Math.floor(Math.random() * tileCount);\n            food.y = Math.floor(Math.random() * tileCount);\n        }\n\n        function checkCollision() {\n            const head = snake[0];\n\n            if (head.x < 0 || head.x >= tileCount || head.y < 0 || head.y >= tileCount) {\n                gameOver();\n            }\n\n            for (let i = 1; i < snake.length; i++) {\n                if (head.x === snake[i].x && head.y === snake[i].y) {\n                    gameOver();\n                }\n            }\n        }\n\n        function gameOver() {\n            gameRunning = false;\n            startBtn.textContent = \'Restart\';\n            startBtn.style.display = \'inline-block\';\n        }\n\n        function updateScore() {\n            scoreElement.textContent = `Score: ${score}`;\n        }\n\n        function resetGame() {\n            snake = [{ x: 10, y: 10 }];\n            food = { x: 15, y: 15 };\n            dx = 0;\n            dy = 0;\n            score = 0;\n            updateScore();\n        }\n\n        document.addEventListener(\'keydown\', changeDirection);\n\n        function changeDirection(event) {\n            const LEFT_KEY = 37;\n            const RIGHT_KEY = 39;\n            const UP_KEY = 38;\n            const DOWN_KEY = 40;\n\n            const keyPressed = event.keyCode;\n\n            const goingUp = dy === -1;\n            const goingDown = dy === 1;\n            const goingRight = dx === 1;\n            const goingLeft = dx === -1;\n\n            if (keyPressed === LEFT_KEY && !goingRight) {\n                dx = -1;\n                dy = 0;\n            }\n\n            if (keyPressed === UP_KEY && !goingDown) {\n                dx = 0;\n                dy = -1;\n            }\n\n            if (keyPressed === RIGHT_KEY && !goingLeft) {\n                dx = 1;\n                dy = 0;\n            }\n\n            if (keyPressed === DOWN_KEY && !goingUp) {\n                dx = 0;\n                dy = 1;\n            }\n        }\n\n        function changeDirectionByButton(direction) {\n            if (direction === \'left\' && dx !== 1) {\n                dx = -1;\n                dy = 0;\n            } else if (direction === \'up\' && dy !== 1) {\n                dx = 0;\n                dy = -1;\n            } else if (direction === \'down\' && dy !== -1) {\n                dx = 0;\n                dy = 1;\n            } else if (direction === \'right\' && dx !== -1) {\n                dx = 1;\n                dy = 0;\n            }\n        }\n\n        startBtn.addEventListener(\'click\', () => {\n            resetGame();\n            gameRunning = true;\n            startBtn.style.display = \'none\';\n            drawGame();\n        });\n\n        clearCanvas();\n    </script>\n</body>\n\n</html>\n```\n\nThis updated version includes the following UI and functionality enhancements:\n\n1. Added directional buttons, making the game playable on mobile devices.\n2. Added a centered game container for a more aesthetic page layout.\n3. Improved the Canvas style with borders and shadow effects.\n4. Added a score display.\n5. Added a start/restart button.\n6. Added gradient colors to the snake and food for a more three-dimensional look.\n7. Added eyes to the snake\'s head for added fun.\n8. Changed the food to a circular shape with gradient effects.\n9. Added a game-over prompt.\n10. Improved the overall color scheme with softer colors.\n\nThis version offers a more visually appealing UI and a better gaming experience. You can save this code as an HTML file and open it in a browser to play the game. Click the "Start Game" button to begin and use the arrow keys to control the direction of the snake.\n\nI hope this updated version meets your needs! If you have any more questions or need further modifications, feel free to let me know.',
      role: 'assistant' as const,
      timestamp: 1721205944862,
      generating: false,
      wordCount: 1303,
      tokenCount: 2973,
      aiProvider: 'openai',
      model: 'GPT-4o',
      status: [],
      tokensUsed: 3165,
    },
  ].map(migrateMessage),
  threadName: 'HTMLchat',
  threads: [],
}

export const mermaidSessionEN: Session = {
  id: 'mermaid-demo-1-en',
  name: 'ChartWhiz',
  type: 'chat',
  picUrl: 'https://download.chatboxai.app/image-demo/chartwhiz.png',
  messages: [
    {
      id: '0001fabe-564a-4b99-b9e3-24c34a6805b2',
      role: 'system' as const,
      content: `You are an AI assistant skilled in using Mermaid diagrams to explain concepts and answer questions. When responding to user queries, please follow these guidelines:
1. Analyze the user's question to determine if a diagram would be suitable for explanation or answering. Suitable scenarios for using diagrams include, but are not limited to: process descriptions, hierarchical structures, timelines, relationship maps, etc.
2. If you decide to use a diagram, choose the most appropriate type of Mermaid diagram, such as Flowchart, Sequence Diagram, Class Diagram, State Diagram, Entity Relationship Diagram, User Journey, Gantt, Pie Chart, Quadrant Chart, Requirement Diagram, Gitgraph (Git) Diagram, C4 Diagram, Mindmaps, Timeline, Zenuml, Sankey, XYChart, Block Diagram, etc.
3. Write the diagram code using Mermaid syntax, ensuring the syntax is correct. Place the diagram code between  and .
4. Provide textual explanations before and after the diagram, explaining the content and key points of the diagram.
5. If the question is complex, use multiple diagrams to explain different aspects.
6. Ensure the diagram is clear and concise, avoiding over-complication or information overload.
7. Where appropriate, combine textual description and diagrams to comprehensively answer the question.
8. If the user's question is not suitable for a diagram, answer in a conventional manner without forcing the use of a diagram.
Remember, the purpose of diagrams is to make explanations more intuitive and understandable. When using diagrams, always aim to enhance the clarity and comprehensiveness of your responses.`,
    },

    {
      id: '00023f79-ed98-403b-adeb-6c74425607de',
      content: 'Explain TCP?',
      role: 'user' as const,
    },
    {
      id: '000309f1-5096-43c6-b726-e5f32649435d',
      content: `
TCP, or Transmission Control Protocol, is a core protocol of the Internet Protocol Suite. It operates at the transport layer and is used to provide a reliable, ordered, and error-checked delivery of a stream of data between applications running on hosts communicating over an IP network.

Here's how TCP works, summarized in a sequence diagram:

\`\`\`mermaid
sequenceDiagram
    participant A as Application A
    participant TCP_A as TCP Layer A
    participant TCP_B as TCP Layer B
    participant B as Application B
    A->>TCP_A: Send data
    TCP_A->>TCP_B: SYN (Synchronize/Start)
    TCP_B->>TCP_A: SYN-ACK (Acknowledge)
    TCP_A->>TCP_B: ACK
    TCP_A->>TCP_B: Data packets
    TCP_B->>TCP_A: ACK for received packets
    TCP_A->>TCP_B: FIN (Finish)
    TCP_B->>TCP_A: ACK for FIN
    TCP_B->>TCP_A: FIN
    TCP_A->>TCP_B: ACK for FIN
    TCP_A->>A: Connection closed
    TCP_B->>B: Connection closed
\`\`\`

### Key Aspects of TCP:

1. **Connection-Oriented**: TCP establishes a connection before data can be sent.
2. **Reliable Delivery**: It ensures data is delivered correctly and in order, resending packets if necessary.
3. **Flow Control**: TCP uses window size adjustments to control how much data can be in transit.
4. **Congestion Control**: It reduces data transmission rate when network congestion is detected.
5. **Error Checking**: Uses checksums to ensure that data is not corrupted during transmission.

The sequence diagram above illustrates the typical TCP connection establishment (handshake), data transfer, and connection termination phases. This three-way handshake process is essential for establishing a reliable connection state between two devices.

If you need more details on any specific part of the TCP protocol or its practical applications, feel free to ask!
            `,
      role: 'assistant' as const,
      timestamp: 1721042681817,
      generating: false,
      wordCount: 559,
      tokenCount: 1119,
      aiProvider: 'openai' as any,
      model: 'GPT-4o',
      status: [],
      tokensUsed: 1165,
    },

    {
      id: '00043f79-ed98-403b-adeb-6c74425607de',
      content: 'Explain the normal distribution',
      role: 'user' as const,
    },
    {
      id: '000509f1-5096-43c6-b726-e5f32649435d',
      content: `Certainly! I'd be happy to explain the normal distribution, also known as the Gaussian distribution. It's a fundamental concept in statistics and probability theory. Let me provide you with an explanation along with a helpful diagram to visualize the key characteristics.

\`\`\`mermaid
xychart-beta
    title "Normal Distribution"
    x-axis [-3, -2, -1, 0, 1, 2, 3]
    y-axis "Probability Density" 0 --> 0.4
    bar [0.004, 0.054, 0.242, 0.399, 0.242, 0.054, 0.004]
    line [0.004, 0.054, 0.242, 0.399, 0.242, 0.054, 0.004]
\`\`\`

The normal distribution is a continuous probability distribution that is symmetric about its mean, with a bell-shaped curve. It's characterized by two parameters: the mean (μ) and the standard deviation (σ). Here are the key points:

1. Shape: The distribution is bell-shaped and symmetrical.
2. Mean, Median, and Mode: In a normal distribution, these three measures of central tendency are all equal.
3. Symmetry: The curve is perfectly symmetrical about the mean.
4. Tails: The tails of the distribution extend infinitely in both directions but approach zero as they do so.
5. Standard Deviations: About 68% of the data falls within one standard deviation of the mean, 95% within two standard deviations, and 99.7% within three standard deviations.

Let's visualize this with a diagram:

This diagram represents a standard normal distribution, where:
- The x-axis shows the number of standard deviations from the mean (0).
- The y-axis represents the probability density.
- The bell-shaped curve is clearly visible.

Key observations from the diagram:
1. The peak of the curve is at the center (0), which represents the mean, median, and mode.
2. The curve is symmetrical on both sides of the center.
3. The tails of the distribution extend outwards, getting closer to the x-axis but never touching it.
4. The area between -1 and 1 (one standard deviation on either side of the mean) contains about 68% of the total area under the curve.

The normal distribution is widely used in various fields, including natural and social sciences, to represent real-valued random variables whose distributions are not known. It's particularly useful because many natural phenomena can be approximated by this distribution, and it has mathematical properties that make it convenient for statistical analysis and modeling.

Understanding the normal distribution is crucial for many statistical techniques, including hypothesis testing, confidence intervals, and regression analysis. It forms the basis for many advanced statistical concepts and is a cornerstone of probability theory and statistics.`,
      role: 'assistant' as const,
      timestamp: 1721042681817,
      generating: false,
      wordCount: 559,
      tokenCount: 1119,
      aiProvider: 'openai' as any,
      model: 'GPT-4o',
      status: [],
      tokensUsed: 1165,
    },

    {
      id: '00063f79-ed98-403b-adeb-6c74425607de',
      content: 'How to master algebra? Please provide a simple answer using a mind map',
      role: 'user' as const,
    },
    {
      id: '000709f1-5096-43c6-b726-e5f32649435d',
      content: `
Certainly! I'll create a simple mind map to illustrate the key steps to master algebra. This mind map will give you a clear overview of the important aspects to focus on.

\`\`\`mermaid
mindmap
  root((Mastering Algebra))
    Fundamentals
      Basic operations
      Order of operations
      Properties of numbers
    Equations
      Linear equations
      Quadratic equations
      Systems of equations
    Functions
      Graphing
      Types of functions
      Transformations
    Practice
      Regular exercises
      Real-world applications
      Problem-solving strategies
    Resources
      Textbooks
      Online courses
      Tutoring
\`\`\`

This mind map outlines a simple approach to mastering algebra. Here's a brief explanation of each main branch:

1. Fundamentals: Start by solidifying your understanding of basic operations, order of operations, and properties of numbers. These form the foundation of algebraic thinking.
2. Equations: Learn how to solve various types of equations, including linear, quadratic, and systems of equations. This is a core skill in algebra.
3. Functions: Understand different types of functions, how to graph them, and how to apply transformations. This helps in visualizing algebraic relationships.
4. Practice: Regular practice is crucial. Solve exercises, apply algebra to real-world problems, and develop problem-solving strategies.
5. Resources: Utilize various learning resources such as textbooks, online courses, and tutoring to support your learning journey.

By focusing on these key areas and progressively building your skills, you can work towards mastering algebra. Remember that consistent practice and patience are key to success in mathematics.
            `,
      role: 'assistant' as const,
      timestamp: 1721042681817,
      generating: false,
      wordCount: 559,
      tokenCount: 1119,
      aiProvider: 'openai' as any,
      model: 'GPT-4o',
      status: [],
      tokensUsed: 1165,
    },
  ].map(migrateMessage),
  threadName: 'Charts',
  threads: [],
}

export const imageCreatorSessionForCN = imageCreatorSessionForEN
export const artifactSessionCN = artifactSessionEN
export const mermaidSessionCN = mermaidSessionEN

defaultSessionsForEN.unshift(imageCreatorSessionForEN, artifactSessionEN, mermaidSessionEN)
// defaultSessionsForCN aliases EN list; no separate Chinese demos
