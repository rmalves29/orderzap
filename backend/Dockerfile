DO nó: 18-slim 

EXECUTE apt-get update && apt-get install -y \ 
 cromo\ 
    fonts-liberation \
    libasound2 \
 libatk-ponte2.0-0 \ 
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libxkbcommon0 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    xdg-utils \
    wget \
 && ln -sf /usr/bin/chromium /usr/bin/chromium-browser \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app 

CÓPIA package.json ./ 
EXECUTE npm install 

CÓPIA . . .  

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium 

CMD ["nó", "server-multitenant-clean.js"] 
