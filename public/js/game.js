// Global variables
let socket;
let canvas;
let ctx;
let currentTeam = null;
let currentClass = null;
let gridSize = 30; // pixels per grid cell
let gridWidth = 30; // Increased from 20
let gridHeight = 20; // Increased from 15
let players = {};
let controlPoints = [];
let timeRemaining = 1800; // 30 minutes in seconds
let timerStarted = false; // Track if timer has started
let timerInterval = null; // Store timer interval
let selectedClassCard = null;
let playerHealth = 100;
let playerPosition = { x: 0, y: 0 }; // Keep track of player's own position
let actionCooldown = false;
let cooldownStartTime = 0;
let gameEffects = []; // Visual effects array
let terrain = []; // Terrain map
let validMoveTargets = []; // Tiles player can move to
let validAttackTargets = []; // Targets player can attack
let hoverX = -1, hoverY = -1; // Current hover position
let terrainTypes = {
  OPEN: 0,
  FOREST: 1,
  WATER: 2,
  MOUNTAIN: 3
};

// For terrain rendering without vibration
let terrainCanvas; // Off-screen canvas for static terrain
let terrainCtx;
let terrainSeed; // Store the seed used for terrain generation
let terrainInitialized = false;

// Simple seeded PRNG for deterministic terrain generation
function mulberry32(a) {
  return function() {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
}

// Initialize with a default seed (will be updated with terrain data)
let seededRandom = mulberry32(Date.now());

// Helper function to safely update element text
function safelyUpdateElement(id, text) {
  const element = document.getElementById(id);
  if (element) {
    element.textContent = text;
  } else {
    console.log(`Warning: Element with id '${id}' not found`);
  }
}

// Debug function to check for required elements
function checkElements() {
  const requiredIds = [
    'timer', 'red-count', 'blue-count', 'status-message', 
    'battle-canvas', 'health-bar', 'health-fill', 'health-text', 
    'cooldown-indicator', 'player-class-display', 'join-red', 'join-blue'
  ];
  
  console.log("Checking for required elements:");
  requiredIds.forEach(id => {
    const element = document.getElementById(id);
    console.log(`${id}: ${element ? 'Found' : 'MISSING'}`);
  });
}

// Character class properties
const CHARACTER_CLASSES = {
  fighter: {
    health: 100,
    damage: 20,
    range: 1,
    moveRange: 3,
    cooldown: 2000, // ms
    color: '#e74c3c'
  },
  archer: {
    health: 70,
    damage: 10,
    range: 6,
    moveRange: 4,
    cooldown: 3000, // ms
    color: '#3498db'
  },
  magician: {
    health: 60,
    damage: 20,
    range: 3,
    moveRange: 2,
    cooldown: 5000, // ms
    color: '#9b59b6'
  },
  healer: {
    health: 80,
    damage: 5,
    healAmount: 15,
    range: 1,
    moveRange: 3,
    cooldown: 4000, // ms
    color: '#2ecc71'
  }
};

// Terrain colors - Enhanced for fantasy look
const TERRAIN_COLORS = {
  [terrainTypes.OPEN]: '#3a6e31',      // Vibrant grass green
  [terrainTypes.FOREST]: '#1b4d2e',    // Dark forest green
  [terrainTypes.WATER]: '#0f5e9c',     // Deep blue for water
  [terrainTypes.MOUNTAIN]: '#6d6552'   // Rocky brown/gray for mountains
};

// Start the client-side timer
function startTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
  }
  
  timerStarted = true;
  timerInterval = setInterval(() => {
    if (timeRemaining > 0) {
      timeRemaining--;
      updateTimerDisplay();
    } else {
      // When timer reaches 0, clear the interval
      clearInterval(timerInterval);
      updateStatus("Game time has expired!");
    }
  }, 1000);
  
  console.log("Client-side timer started. Time remaining:", timeRemaining);
}

// Initialize YouTube player
let player;
function onYouTubeIframeAPIReady() {
  player = new YT.Player('player', {
    height: '180',
    width: '100%',
    videoId: '7VPLLYAUEYs', // Your video ID
    playerVars: {
      'autoplay': 1,
      'controls': 1,
      'mute': 1, // Start muted to comply with autoplay policies
      'loop': 1,
      'playlist': '7VPLLYAUEYs' // Required for looping
    }
  });
}

// Initialize the game when the page loads
window.onload = function() {
  console.log("Window loaded");
  
  // Check for required elements
  checkElements();
  
  // Set up the canvas
  canvas = document.getElementById('battle-canvas');
  if (!canvas) {
    console.error("Canvas element not found!");
    return;
  }
  
  ctx = canvas.getContext('2d');
  canvas.width = gridWidth * gridSize;
  canvas.height = gridHeight * gridSize;
  
  // Set up the off-screen terrain canvas
  terrainCanvas = document.createElement('canvas');
  terrainCanvas.width = gridWidth * gridSize;
  terrainCanvas.height = gridHeight * gridSize;
  terrainCtx = terrainCanvas.getContext('2d');
  
  // Set up event listeners
  setupEventListeners();
  
  // Initialize socket.io connection
  initializeSocket();
  
  // Start the game loop
  requestAnimationFrame(gameLoop);
  
  // Start the timer immediately (it will update with server time when connected)
  startTimer();
};

// Set up event listeners
function setupEventListeners() {
  // Team selection buttons
  const joinRedBtn = document.getElementById('join-red');
  const joinBlueBtn = document.getElementById('join-blue');
  
  if (joinRedBtn) {
    joinRedBtn.addEventListener('click', () => joinTeam('red'));
  } else {
    console.error("Join Red button not found!");
  }
  
  if (joinBlueBtn) {
    joinBlueBtn.addEventListener('click', () => joinTeam('blue'));
  } else {
    console.error("Join Blue button not found!");
  }
  
  // Class selection
  const classOptions = document.getElementById('class-options');
  if (classOptions) {
    const classCards = document.querySelectorAll('.class-card');
    classCards.forEach(card => {
      card.addEventListener('click', function() {
        // Remove selection from all cards
        classCards.forEach(c => c.classList.remove('selected'));
        
        // Add selection to clicked card
        this.classList.add('selected');
        selectedClassCard = this;
        
        // Select the class
        const className = this.getAttribute('data-class');
        selectClass(className);
      });
    });
  }
  
  // Canvas click for game actions
  if (canvas) {
    canvas.addEventListener('click', handleCanvasClick);
  }
  
  // Request move/attack targets on mousemove for visual feedback
  if (canvas) {
    canvas.addEventListener('mousemove', (e) => {
      if (currentTeam && currentClass) {
        // Get grid coordinates
        const rect = canvas.getBoundingClientRect();
        const gridX = Math.floor((e.clientX - rect.left) / gridSize);
        const gridY = Math.floor((e.clientY - rect.top) / gridSize);
        
        // Update hover coordinates
        hoverX = gridX;
        hoverY = gridY;
      }
    });
    
    canvas.addEventListener('mouseout', () => {
      // Clear hover effect when mouse leaves canvas
      hoverX = -1;
      hoverY = -1;
    });
  }
}

// Initialize socket connection
function initializeSocket() {
  console.log("Initializing socket connection");
  socket = io({
    transports: ['polling', 'websocket']
  });
  
  // Connection events
  socket.on('connect', () => {
    console.log("Connected to server with ID:", socket.id);
    updateStatus("Connected to game server");
  });
  
  socket.on('disconnect', () => {
    console.log("Disconnected from server");
    updateStatus("Disconnected from game server");
  });
  
  socket.on('error', (error) => {
    console.error("Error:", error);
    updateStatus("Error: " + error);
  });
  
  // Team events
  socket.on('teamJoined', (team) => {
    console.log("Joined team:", team);
    currentTeam = team;
    
    // Update team display in UI
    const teamText = document.getElementById('status-message');
    if (teamText) {
      teamText.textContent = `You joined the ${team} team! Select your class.`;
      teamText.style.color = team === 'red' ? '#ff4444' : '#4444ff';
    }
    
    // IMPORTANT: Don't increment counts locally - this was causing the issue
    // This is now handled by the teamCounts event from the server
    
    // Hide team buttons, show class selection
    const teamButtons = document.querySelectorAll('#team-buttons');
    teamButtons.forEach(btn => {
      if (btn) btn.classList.add('hidden');
    });
    
    const classOptions = document.getElementById('class-options');
    if (classOptions) {
      classOptions.classList.remove('hidden');
      classOptions.style.display = 'flex';
    }
    
    console.log("Class options should now be visible");
  });
  
  // CRITICAL: This event properly updates the team counts from the server
  socket.on('teamCounts', function(counts) {
    console.log("Received team counts:", counts);
    
    // Directly update the UI with the received values
    safelyUpdateElement('red-count', counts.red);
    safelyUpdateElement('blue-count', counts.blue);
  });

  socket.on('teamSizes', (sizes) => {
    // Update team sizes display if needed
    console.log("Team sizes:", sizes);
  });
  
  // Class selection
  socket.on('classSelected', (data) => {
    console.log("Class selected:", data);
    currentClass = data.class;
    playerHealth = data.health;
    
    // Store player's initial position
    playerPosition = { x: data.x, y: data.y };
    
    // Store valid targets
    validMoveTargets = data.moveTargets || [];
    validAttackTargets = data.attackTargets || [];
    
    // Hide class selection, show game
    const classSelection = document.getElementById('class-selection');
    const playerStats = document.getElementById('player-stats');
    
    if (classSelection) classSelection.classList.add('hidden');
    if (playerStats) playerStats.classList.remove('hidden');
    
    // Update UI elements
    const playerClassDisplay = document.getElementById('player-class-display');
    if (playerClassDisplay) {
      playerClassDisplay.textContent = 
        `${currentClass.charAt(0).toUpperCase() + currentClass.slice(1)} - ${currentTeam.charAt(0).toUpperCase() + currentTeam.slice(1)} Team`;
    }
    
    updateStatus(`You joined the battle as a ${currentClass}!`);
    updateHealthBar();
    
    // Make sure we have our player in the players list
    if (!players[socket.id]) {
      players[socket.id] = {
        id: socket.id,
        team: currentTeam,
        class: currentClass,
        x: data.x,
        y: data.y,
        health: data.health,
        isDead: false
      };
    }
  });
  
  // Game state events
  socket.on('gameState', (state) => {
    console.log("Received game state:", state);
    timeRemaining = state.timeRemaining;
    controlPoints = state.controlPoints;
    
    // Start/reset timer when receiving game state
    startTimer();
    
    // Update grid dimensions if provided
    if (state.gridWidth && state.gridHeight) {
      gridWidth = state.gridWidth;
      gridHeight = state.gridHeight;
      canvas.width = gridWidth * gridSize;
      canvas.height = gridHeight * gridSize;
      
      // Update terrain canvas dimensions if needed
      terrainCanvas.width = gridWidth * gridSize;
      terrainCanvas.height = gridHeight * gridSize;
    }
    
    // Update terrain if provided
    if (state.terrain) {
      console.log("Received terrain data from server", state.terrain.length, "x", state.terrain[0]?.length);
      terrain = state.terrain;
      
      // Use gameId as terrain seed for consistent rendering
      terrainSeed = state.gameId || Date.now().toString();
      seededRandom = mulberry32(parseInt(terrainSeed.substring(0, 10)) || Date.now());
      
      // Draw terrain to off-screen canvas
      drawTerrainToOffscreenCanvas();
    }
    
    updateScoreDisplay(state.scores);
    updateTimerDisplay();
    
    // Update team counts if provided
    if (state.teamCounts) {
      safelyUpdateElement('red-count', state.teamCounts.red);
      safelyUpdateElement('blue-count', state.teamCounts.blue);
    }
  });
  
  socket.on('gameUpdate', (update) => {
    // Only update the time if our timer isn't running
    if (!timerStarted) {
      timeRemaining = update.timeRemaining;
      updateTimerDisplay();
    }
    
    // Always update control points and scores
    controlPoints = update.controlPoints;
    updateScoreDisplay(update.scores);
    
    // Update team counts if provided
    if (update.teamCounts) {
      safelyUpdateElement('red-count', update.teamCounts.red);
      safelyUpdateElement('blue-count', update.teamCounts.blue);
    }
  });
  
  socket.on('newGame', (data) => {
    timeRemaining = data.timeRemaining;
    controlPoints = data.controlPoints;
    if (data.terrain) {
      terrain = data.terrain;
      
      // Update terrain seed for new game
      terrainSeed = data.gameId || Date.now().toString();
      seededRandom = mulberry32(parseInt(terrainSeed.substring(0, 10)) || Date.now());
      
      // Redraw terrain for new game
      drawTerrainToOffscreenCanvas();
    }
    updateScoreDisplay(data.scores);
    updateStatus("A new game has started!");
    
    // Reset and start timer for new game
    startTimer();
    
    // Update team counts for new game
    if (data.teamCounts) {
      safelyUpdateElement('red-count', data.teamCounts.red);
      safelyUpdateElement('blue-count', data.teamCounts.blue);
    }
  });
  
  socket.on('terrainUpdated', (newTerrain) => {
    console.log("Received updated terrain from server", newTerrain.length, "x", newTerrain[0]?.length);
    terrain = newTerrain;
    
    // Generate new seed for regenerated terrain
    terrainSeed = Date.now().toString();
    seededRandom = mulberry32(parseInt(terrainSeed.substring(0, 10)) || Date.now());
    
    // Redraw the terrain on the off-screen canvas
    drawTerrainToOffscreenCanvas();
  });
  
  socket.on('gameEnd', (results) => {
    console.log("Game ended:", results);
    let message = "";
    
    if (results.winner === 'red') {
      message = "Red team wins!";
    } else if (results.winner === 'blue') {
      message = "Blue team wins!";
    } else {
      message = "Game ended in a tie!";
    }
    
    message += ` Final score: Red ${results.redScore} - ${results.blueScore} Blue`;
    updateStatus(message);
    
    // Stop the timer
    if (timerInterval) {
      clearInterval(timerInterval);
      timerStarted = false;
    }
  });
  
  // Player events
  socket.on('playerList', (list) => {
    console.log("Received player list:", list);
    players = {};
    list.forEach(player => {
      players[player.id] = player;
      
      // Update our own position if we're in the list
      if (player.id === socket.id) {
        playerPosition = { x: player.x, y: player.y };
      }
    });
  });
  
  socket.on('playerJoined', (player) => {
    console.log("Player joined:", player);
    players[player.id] = player;
  });
  
  socket.on('playerLeft', (playerId) => {
    console.log("Player left:", playerId);
    delete players[playerId];
  });
  
  socket.on('playerMoved', (data) => {
    if (players[data.id]) {
      players[data.id].x = data.x;
      players[data.id].y = data.y;
      
      // Update our own position if this is our move
      if (data.id === socket.id) {
        playerPosition = { x: data.x, y: data.y };
      }
    }
  });
  
  socket.on('playerMoveResult', (result) => {
    if (result.success) {
      // Update player position locally
      playerPosition = { x: result.x, y: result.y };
      
      // Update our entry in the players object
      if (players[socket.id]) {
        players[socket.id].x = result.x;
        players[socket.id].y = result.y;
      }
      
      // Update valid targets
      validMoveTargets = result.moveTargets || [];
      validAttackTargets = result.attackTargets || [];
    } else {
      updateStatus(`Move failed: ${result.reason}`);
    }
  });
  
  // Receive move targets
  socket.on('moveTargets', (targets) => {
    validMoveTargets = targets;
  });
  
  // Receive attack targets
  socket.on('attackTargets', (targets) => {
    validAttackTargets = targets;
  });
  
  socket.on('pointCaptured', (data) => {
    console.log("Point captured:", data);
    updateStatus(`Team ${data.team} captured control point ${data.pointId}!`);
    
    // Add a capture effect
    const capturedPoint = controlPoints.find(p => p.id === data.pointId);
    if (capturedPoint) {
      addEffect(capturedPoint.x, capturedPoint.y, 'capture', data.team);
      // Update local control point data
      capturedPoint.controllingTeam = data.team;
    }
  });
  
  socket.on('actionResult', (result) => {
    console.log("Action result:", result);
    
    // Update player state if it's our action
    if (result.sourceId === socket.id) {
      actionCooldown = true;
      cooldownStartTime = Date.now();
      setTimeout(() => {
        actionCooldown = false;
        
        // Request fresh targets
        socket.emit('requestMoveTargets');
        socket.emit('requestAttackTargets');
      }, CHARACTER_CLASSES[currentClass].cooldown);
    }
    
    // Update target state
    if (result.type === 'attack') {
      const target = players[result.targetId];
      if (target) {
        target.health -= result.damage;
        if (result.killed) {
          target.isDead = true;
        }
        
        // Add damage effect
        addEffect(target.x, target.y, 'damage');
        
        // Update our health if we were attacked
        if (result.targetId === socket.id) {
          playerHealth = target.health;
          updateHealthBar();
        }
      }
    } else if (result.type === 'heal') {
      const target = players[result.targetId];
      if (target) {
        target.health += result.amount;
        
        // Add heal effect
        addEffect(target.x, target.y, 'heal');
      }
      
      // If we were healed, update our health
      if (result.targetId === socket.id) {
        playerHealth = target.health;
        updateHealthBar();
      }
    }
  });
  
  socket.on('actionConfirmed', (result) => {
    // Update valid targets after our action
    validMoveTargets = result.moveTargets || [];
    validAttackTargets = result.attackTargets || [];
  });
  
  socket.on('actionFailed', (result) => {
    console.log("Action failed:", result);
    updateStatus(`Action failed: ${result.reason}`);
  });
  
  socket.on('respawn', (data) => {
    console.log("Respawned:", data);
    playerHealth = data.health;
    
    // Update our position
    playerPosition = { x: data.x, y: data.y };
    
    // Update our entry in the players object
    if (players[socket.id]) {
      players[socket.id].x = data.x;
      players[socket.id].y = data.y;
      players[socket.id].health = data.health;
      players[socket.id].isDead = false;
    }
    
    updateHealthBar();
    updateStatus("You have respawned!");
    
    // Request fresh targets after respawn
    socket.emit('requestMoveTargets');
    socket.emit('requestAttackTargets');
  });
}

// Join a team
function joinTeam(team) {
  console.log("Joining team:", team);
  socket.emit('joinTeam', team);
}

// Select a class
function selectClass(className) {
  console.log("Selecting class:", className);
  currentClass = className;
  socket.emit('selectClass', className);
}

// Handle canvas clicks for movement and actions
function handleCanvasClick(e) {
  if (!currentTeam || !currentClass) return;
  
  // Get grid coordinates from click
  const rect = canvas.getBoundingClientRect();
  const clickX = e.clientX - rect.left;
  const clickY = e.clientY - rect.top;
  
  const gridX = Math.floor(clickX / gridSize);
  const gridY = Math.floor(clickY / gridSize);
  
  console.log(`Clicked grid: (${gridX}, ${gridY})`);
  
  // Check if there's a player at the target position (attack/heal)
  let targetFound = false;
  
  // Check if this is a valid attack target
  const attackTarget = validAttackTargets.find(t => t.x === gridX && t.y === gridY);
  if (attackTarget) {
    targetFound = true;
    if (!actionCooldown) {
      console.log("Attempting action on position:", gridX, gridY);
      socket.emit('action', { x: gridX, y: gridY });
    } else {
      updateStatus("Action on cooldown!");
    }
  }
  
  // If no action target, try to move there
  if (!targetFound) {
    // Check if it's a valid move target
    const isValidMove = validMoveTargets.some(t => t.x === gridX && t.y === gridY);
    if (isValidMove) {
      console.log("Attempting to move to:", gridX, gridY);
      socket.emit('move', { x: gridX, y: gridY });
      
      // Update position immediately for better responsiveness
      // This will be corrected if the server rejects the move
      playerPosition = { x: gridX, y: gridY };
      if (players[socket.id]) {
        players[socket.id].x = gridX;
        players[socket.id].y = gridY;
      }
    } else {
      updateStatus("Invalid move target!");
    }
  }
}

// Main game loop
function gameLoop() {
  if (!canvas || !ctx) return;
  
  // Clear canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  // Draw the static terrain from the off-screen canvas if initialized
  if (terrainInitialized) {
    ctx.drawImage(terrainCanvas, 0, 0);
  } else {
    // First-time initialization fallback
    if (terrain && terrain.length > 0) {
      drawTerrainToOffscreenCanvas();
    } else {
      // Default background if no terrain
      ctx.fillStyle = '#1e1e1e';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }
  
  // Draw dynamic elements
  drawValidMoveTargets();
  drawValidAttackTargets();
  drawControlPoints();
  drawPlayers();
  drawEffects();
  drawHoverEffect();
  updateCooldownIndicator();
  
  requestAnimationFrame(gameLoop);
}

// Draws the terrain ONCE to the off-screen canvas
function drawTerrainToOffscreenCanvas() {
  if (!terrainCtx) return;
  
  console.log("Drawing terrain to off-screen canvas...");
  
  // Clear the terrain canvas
  terrainCtx.clearRect(0, 0, terrainCanvas.width, terrainCanvas.height);
  
  // Draw terrain based on terrain data
  if (terrain && terrain.length > 0) {
    for (let y = 0; y < gridHeight; y++) {
      for (let x = 0; x < gridWidth; x++) {
        const terrainType = (terrain[y] && terrain[y][x] !== undefined) ? 
          terrain[y][x] : terrainTypes.OPEN;
        
        // Base terrain color
        terrainCtx.fillStyle = TERRAIN_COLORS[terrainType] || '#1e1e1e';
        terrainCtx.fillRect(x * gridSize, y * gridSize, gridSize, gridSize);
        
        // Add detailed terrain rendering based on type
        switch(terrainType) {
          case terrainTypes.FOREST:
            drawDetailedForest(x, y, terrainCtx);
            break;
          case terrainTypes.WATER:
            drawDetailedWater(x, y, terrainCtx);
            break;
          case terrainTypes.MOUNTAIN:
            drawDetailedMountain(x, y, terrainCtx);
            break;
          case terrainTypes.OPEN:
            drawDetailedGrass(x, y, terrainCtx);
            break;
        }
      }
    }
  } else {
    // Default background if no terrain data
    terrainCtx.fillStyle = '#1e1e1e';
    terrainCtx.fillRect(0, 0, terrainCanvas.width, terrainCanvas.height);
  }
  
  // Draw faint grid lines
  terrainCtx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  terrainCtx.lineWidth = 0.5;
  
  // Vertical lines
  for (let x = 0; x <= gridWidth; x++) {
    terrainCtx.beginPath();
    terrainCtx.moveTo(x * gridSize, 0);
    terrainCtx.lineTo(x * gridSize, terrainCanvas.height);
    terrainCtx.stroke();
  }
  
  // Horizontal lines
  for (let y = 0; y <= gridHeight; y++) {
    terrainCtx.beginPath();
    terrainCtx.moveTo(0, y * gridSize);
    terrainCtx.lineTo(terrainCanvas.width, y * gridSize);
    terrainCtx.stroke();
  }
  
  // Draw team base areas with subtle indicators
  terrainCtx.fillStyle = 'rgba(255, 0, 0, 0.1)';
  terrainCtx.fillRect(0, 0, 4 * gridSize, terrainCanvas.height);
  
  terrainCtx.fillStyle = 'rgba(0, 0, 255, 0.1)';
  terrainCtx.fillRect(terrainCanvas.width - 4 * gridSize, 0, 4 * gridSize, terrainCanvas.height);
  
  // Mark terrain as initialized
  terrainInitialized = true;
  
  console.log("Terrain rendering complete");
}

// Detailed grass (open terrain) - uses seeded random for stability
function drawDetailedGrass(x, y, context) {
  const ctx = context || terrainCtx; // Use provided context or default
  if (!ctx) return;
  
  const tileX = x * gridSize;
  const tileY = y * gridSize;
  
  // Add grass texture with variance using seeded random
  const grassiness = 0.3 + seededRandom() * 0.1;
  ctx.fillStyle = `rgba(76, 175, 80, ${grassiness})`;
  
  // Random grass blades with seeded random for stability
  const bladeCount = 3 + Math.floor(seededRandom() * 5);
  for (let i = 0; i < bladeCount; i++) {
    const grassX = tileX + seededRandom() * gridSize;
    const grassY = tileY + seededRandom() * gridSize;
    const grassHeight = 2 + seededRandom() * 3;
    
    ctx.beginPath();
    ctx.moveTo(grassX, grassY);
    ctx.lineTo(grassX - 1, grassY - grassHeight);
    ctx.lineTo(grassX + 1, grassY - grassHeight);
    ctx.closePath();
    ctx.fill();
  }
}

// Detailed forest rendering - uses seeded random for stability
function drawDetailedForest(x, y, context) {
  const ctx = context || terrainCtx; // Use provided context or default
  if (!ctx) return;
  
  const centerX = (x + 0.5) * gridSize;
  const centerY = (y + 0.5) * gridSize;
  const treeSize = gridSize * 0.7;
  
  // Generate a deterministic seed for this tile based on position
  const tileSeed = x * 1000 + y;
  
  // Draw multiple trees
  const treeCount = 1 + Math.floor(seededRandom() * 2); // 1-2 trees per tile
  for (let i = 0; i < treeCount; i++) {
    // Random position within the tile with some offset - use seeded random
    const offsetX = (seededRandom() - 0.5) * gridSize * 0.5;
    const offsetY = (seededRandom() - 0.5) * gridSize * 0.5;
    const treeX = centerX + offsetX;
    const treeY = centerY + offsetY;
    const size = treeSize * (0.7 + seededRandom() * 0.3);
    
    // Tree trunk
    ctx.fillStyle = '#5d4037';
    ctx.fillRect(treeX - size * 0.1, treeY, size * 0.2, size * 0.3);
    
    // Tree foliage - multiple levels for a fuller look
    const greenColors = ['#2e7d32', '#388e3c', '#43a047', '#4caf50'];
    
    for (let j = 0; j < 3; j++) {
      ctx.beginPath();
      ctx.moveTo(treeX - size/2 * (1 - j*0.2), treeY - j*size*0.25);
      ctx.lineTo(treeX + size/2 * (1 - j*0.2), treeY - j*size*0.25);
      ctx.lineTo(treeX, treeY - size*0.5 - j*size*0.25);
      ctx.closePath();
      ctx.fillStyle = greenColors[j % greenColors.length];
      ctx.fill();
    }
  }
}

// Detailed water rendering - water animation will still be dynamic in the main loop
function drawDetailedWater(x, y, context) {
  const ctx = context || terrainCtx; // Use provided context or default
  if (!ctx) return;
  
  const tileX = x * gridSize;
  const tileY = y * gridSize;
  
  // Base water with gradient
  const gradient = ctx.createLinearGradient(tileX, tileY, tileX + gridSize, tileY + gridSize);
  gradient.addColorStop(0, '#1a4d80');
  gradient.addColorStop(0.5, '#1e5799');
  gradient.addColorStop(1, '#1a4d80');
  ctx.fillStyle = gradient;
  ctx.fillRect(tileX, tileY, gridSize, gridSize);
  
  // For water, we'll draw static wave patterns here
  // The actual animation will be handled separately if needed
  ctx.strokeStyle = 'rgba(100, 181, 246, 0.4)';
  ctx.lineWidth = 1;
  
  // Draw static wave patterns using deterministic positions
  for (let i = 0; i < 3; i++) {
    const waveY = tileY + (i + 0.3) * gridSize / 3;
    
    ctx.beginPath();
    ctx.moveTo(tileX, waveY);
    ctx.bezierCurveTo(
      tileX + gridSize/4, waveY - gridSize/10,
      tileX + gridSize/2, waveY + gridSize/10,
      tileX + gridSize, waveY
    );
    ctx.stroke();
  }
}

// Detailed mountain/wall rendering - uses seeded random for stability
function drawDetailedMountain(x, y, context) {
  const ctx = context || terrainCtx; // Use provided context or default
  if (!ctx) return;
  
  const centerX = (x + 0.5) * gridSize;
  const centerY = (y + 0.5) * gridSize;
  const mountainSize = gridSize * 0.8;
  
  // Draw mountain base with realistic shape
  ctx.beginPath();
  ctx.moveTo(centerX - mountainSize/2, centerY + mountainSize/3);
  ctx.lineTo(centerX - mountainSize/4, centerY - mountainSize/2);
  ctx.lineTo(centerX, centerY - mountainSize/3);
  ctx.lineTo(centerX + mountainSize/4, centerY - mountainSize/2);
  ctx.lineTo(centerX + mountainSize/2, centerY + mountainSize/3);
  ctx.closePath();
  
  // Mountain gradient for 3D effect
  const gradient = ctx.createLinearGradient(
    centerX - mountainSize/2, centerY, 
    centerX + mountainSize/2, centerY
  );
  gradient.addColorStop(0, '#4e342e');
  gradient.addColorStop(0.5, '#6d4c41');
  gradient.addColorStop(1, '#5d4037');
  ctx.fillStyle = gradient;
  ctx.fill();
  
  ctx.strokeStyle = '#3e2723';
  ctx.lineWidth = 1;
  ctx.stroke();
  
  // Draw mountain ridges for texture
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.lineWidth = 1.5;
  const ridgeCount = 2 + Math.floor(seededRandom() * 3); // Deterministic ridge count
  
  for (let i = 0; i < ridgeCount; i++) {
    // Deterministic ridge positions
    const ridgeOffset = (seededRandom() - 0.5) * mountainSize * 0.2;
    ctx.beginPath();
    ctx.moveTo(centerX + ridgeOffset, centerY - mountainSize/4);
    ctx.lineTo(centerX + ridgeOffset + (seededRandom() - 0.5) * mountainSize * 0.1, centerY + mountainSize/4);
    ctx.stroke();
  }
  
  // Add shadowing for 3D effect
  ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
  ctx.beginPath();
  ctx.moveTo(centerX, centerY - mountainSize/3);
  ctx.lineTo(centerX + mountainSize/4, centerY - mountainSize/2);
  ctx.lineTo(centerX + mountainSize/2, centerY + mountainSize/3);
  ctx.lineTo(centerX, centerY + mountainSize/6);
  ctx.closePath();
  ctx.fill();
  
  // Draw snow cap for mountains
  ctx.beginPath();
  ctx.moveTo(centerX - mountainSize/5, centerY - mountainSize/2.5);
  ctx.lineTo(centerX, centerY - mountainSize/2.1);
  ctx.lineTo(centerX + mountainSize/5, centerY - mountainSize/2.5);
  ctx.lineTo(centerX + mountainSize/6, centerY - mountainSize/1.9);
  ctx.lineTo(centerX - mountainSize/6, centerY - mountainSize/1.9);
  ctx.closePath();
  ctx.fillStyle = '#f5f5f5';
  ctx.fill();
}

// Draw hover effect on grid cell
function drawHoverEffect() {
  if (!ctx || hoverX < 0 || hoverY < 0 || hoverX >= gridWidth || hoverY >= gridHeight) return;
  
  const isValidMove = validMoveTargets.some(t => t.x === hoverX && t.y === hoverY);
  const isValidAttack = validAttackTargets.some(t => t.x === hoverX && t.y === hoverY);
  
  if (isValidMove || isValidAttack) {
    ctx.strokeStyle = isValidAttack ? 'rgba(255, 0, 0, 0.8)' : 'rgba(255, 255, 0, 0.8)';
    ctx.lineWidth = 2;
    ctx.strokeRect(hoverX * gridSize + 2, hoverY * gridSize + 2, gridSize - 4, gridSize - 4);
  }
}

// Draw valid move targets
function drawValidMoveTargets() {
  if (!ctx || !validMoveTargets || !validMoveTargets.length) return;
  
  ctx.fillStyle = 'rgba(255, 255, 0, 0.2)';
  
  validMoveTargets.forEach(target => {
    ctx.fillRect(target.x * gridSize, target.y * gridSize, gridSize, gridSize);
    
    // Add subtle pulsing glow
    ctx.strokeStyle = 'rgba(255, 255, 0, 0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(target.x * gridSize + 3, target.y * gridSize + 3, gridSize - 6, gridSize - 6);
  });
}

// Draw valid attack targets
function drawValidAttackTargets() {
  if (!ctx || !validAttackTargets || !validAttackTargets.length) return;
  
  validAttackTargets.forEach(target => {
    // Fill with translucent red
    ctx.fillStyle = 'rgba(255, 0, 0, 0.2)';
    ctx.fillRect(target.x * gridSize, target.y * gridSize, gridSize, gridSize);
    
    // Draw target indicator
    const centerX = (target.x + 0.5) * gridSize;
    const centerY = (target.y + 0.5) * gridSize;
    const radius = gridSize * 0.3;
    
    // Outer circle
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 0, 0, 0.5)';
    ctx.fill();
    
    // Inner circle
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius * 0.6, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.fill();
    
    // Center dot
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius * 0.2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 0, 0, 0.8)';
    ctx.fill();
  });
}

// Draw control points - Enhanced fantasy style
function drawControlPoints() {
  if (!ctx || !controlPoints || !Array.isArray(controlPoints)) return;
  
  controlPoints.forEach(point => {
    const centerX = (point.x + 0.5) * gridSize;
    const centerY = (point.y + 0.5) * gridSize;
    
    // Draw control area (larger circle showing capture zone)
    ctx.beginPath();
    ctx.arc(centerX, centerY, gridSize * 2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(150, 150, 150, 0.1)';
    ctx.fill();
    
    // Add a dashed outline to show capture zone
    ctx.beginPath();
    ctx.setLineDash([5, 5]);
    ctx.arc(centerX, centerY, gridSize * 2, 0, Math.PI * 2);
    if (point.controllingTeam === 'red') {
      ctx.strokeStyle = 'rgba(255, 0, 0, 0.5)';
    } else if (point.controllingTeam === 'blue') {
      ctx.strokeStyle = 'rgba(0, 0, 255, 0.5)';
    } else {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    }
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.setLineDash([]);
    
    // Draw base circle - fantasy styled banner/flag
    const bannerHeight = gridSize * 0.8;
    const bannerWidth = gridSize * 0.6;
    const poleWidth = gridSize * 0.1;
    
    // Draw banner pole
    ctx.fillStyle = '#8d6e63';
    ctx.fillRect(centerX - poleWidth/2, centerY - bannerHeight, poleWidth, bannerHeight);
    
    // Draw banner cloth
    ctx.beginPath();
    ctx.moveTo(centerX, centerY - bannerHeight);
    ctx.lineTo(centerX + bannerWidth, centerY - bannerHeight + bannerHeight/4);
    ctx.lineTo(centerX + bannerWidth, centerY - bannerHeight/2);
    ctx.lineTo(centerX, centerY - bannerHeight/4);
    ctx.closePath();
    
    if (point.controllingTeam === 'red') {
      ctx.fillStyle = 'rgba(255, 0, 0, 0.8)';
    } else if (point.controllingTeam === 'blue') {
      ctx.fillStyle = 'rgba(0, 0, 255, 0.8)';
    } else {
      ctx.fillStyle = 'rgba(150, 150, 150, 0.7)';
    }
    ctx.fill();
    
    // Banner outline
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.stroke();
    
    // Draw control point ID on banner
    ctx.font = 'bold 16px Arial';
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(point.id, centerX + bannerWidth/2, centerY - bannerHeight/2 - bannerHeight/8);
    
    // Draw capture progress if any
    if (point.captureProgress && point.captureProgress.red > 0 && point.captureProgress.red < 100) {
      drawCaptureProgress(centerX, centerY, point.captureProgress.red / 100, 'red');
    }
    
    if (point.captureProgress && point.captureProgress.blue > 0 && point.captureProgress.blue < 100) {
      drawCaptureProgress(centerX, centerY, point.captureProgress.blue / 100, 'blue');
    }
  });
}

// Draw capture progress indicator
function drawCaptureProgress(x, y, progress, team) {
  if (!ctx) return;
  
  const radius = gridSize * 0.6;
  const startAngle = -Math.PI / 2;
  const endAngle = startAngle + (Math.PI * 2 * progress);
  
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.arc(x, y, radius, startAngle, endAngle);
  ctx.closePath();
  
  if (team === 'red') {
    ctx.fillStyle = 'rgba(255, 0, 0, 0.3)';
  } else {
    ctx.fillStyle = 'rgba(0, 0, 255, 0.3)';
  }
  
  ctx.fill();
  
  // Add pulsing effect for active capture
  const pulseSize = radius + Math.sin(Date.now() / 200) * 3;
  ctx.beginPath();
  ctx.arc(x, y, pulseSize, startAngle, endAngle);
  ctx.strokeStyle = team === 'red' ? 'rgba(255, 0, 0, 0.5)' : 'rgba(0, 0, 255, 0.5)';
  ctx.lineWidth = 2;
  ctx.stroke();
}

// Draw players - Enhanced
function drawPlayers() {
  if (!ctx) return;
  
  for (const id in players) {
    const player = players[id];
    if (player.isDead) continue;
    
    // If this is us, use our tracked position for better responsiveness
    const playerX = (id === socket.id) ? playerPosition.x : player.x;
    const playerY = (id === socket.id) ? playerPosition.y : player.y;
    
    const centerX = (playerX + 0.5) * gridSize;
    const centerY = (playerY + 0.5) * gridSize;
    
    // Draw fantasy-style character
    drawFantasyCharacter(centerX, centerY, player.team, player.class, id === socket.id);
    
    // Draw health bar
    const maxHealth = CHARACTER_CLASSES[player.class] ? CHARACTER_CLASSES[player.class].health : 100;
    const healthPercent = player.health / maxHealth;
    const barWidth = gridSize * 0.7;
    
    // Health bar background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(centerX - barWidth/2, centerY + gridSize * 0.25, barWidth, 5);
    
    // Health fill
    if (healthPercent > 0.6) ctx.fillStyle = '#2ecc71';
    else if (healthPercent > 0.3) ctx.fillStyle = '#f39c12';
    else ctx.fillStyle = '#e74c3c';
    
    ctx.fillRect(centerX - barWidth/2, centerY + gridSize * 0.25, barWidth * healthPercent, 5);
    
    // Health bar outline for better visibility
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(centerX - barWidth/2, centerY + gridSize * 0.25, barWidth, 5);
  }
}

// Draw fantasy character
function drawFantasyCharacter(x, y, team, characterClass, isCurrentPlayer) {
  if (!ctx) return;
  
  const size = gridSize * 0.4;
  
  // Base character circle with team color
  ctx.beginPath();
  ctx.arc(x, y, size, 0, Math.PI * 2);
  
  // Player color based on team and class
  if (team === 'red') {
    ctx.fillStyle = CHARACTER_CLASSES[characterClass] ? CHARACTER_CLASSES[characterClass].color : '#e74c3c';
  } else {
    // Adjust blue team colors to be more distinguishable
    switch (characterClass) {
      case 'fighter':
        ctx.fillStyle = '#2980b9';
        break;
      case 'archer':
        ctx.fillStyle = '#27ae60';
        break;
      case 'magician':
        ctx.fillStyle = '#8e44ad';
        break;
      case 'healer':
        ctx.fillStyle = '#16a085';
        break;
      default:
        ctx.fillStyle = '#3498db';
    }
  }
  ctx.fill();
  
  // Add a border for visibility
  ctx.strokeStyle = isCurrentPlayer ? '#ffffff' : (team === 'red' ? '#ffcccc' : '#ccccff');
  ctx.lineWidth = isCurrentPlayer ? 3 : 1.5;
  ctx.stroke();
  
  // Draw character icon based on class
  const iconSize = size * 0.8;
  
  switch (characterClass) {
    case 'fighter':
      // Sword icon
      ctx.beginPath();
      ctx.moveTo(x - iconSize/2, y + iconSize/2);
      ctx.lineTo(x + iconSize/2, y - iconSize/2);
      ctx.moveTo(x - iconSize/4, y - iconSize/4);
      ctx.lineTo(x + iconSize/4, y - iconSize/4);
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 2;
      ctx.stroke();
      break;
      
    case 'archer':
      // Bow icon
      ctx.beginPath();
      ctx.arc(x, y, iconSize/2, -Math.PI/4, Math.PI/4);
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 2;
      ctx.stroke();
      
      // Arrow
      ctx.beginPath();
      ctx.moveTo(x - iconSize/3, y);
      ctx.lineTo(x + iconSize/2, y);
      ctx.moveTo(x + iconSize/3, y - iconSize/6);
      ctx.lineTo(x + iconSize/2, y);
      ctx.lineTo(x + iconSize/3, y + iconSize/6);
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      break;
      
    case 'magician':
      // Magic staff/wand
      ctx.beginPath();
      ctx.moveTo(x, y - iconSize/2);
      ctx.lineTo(x, y + iconSize/3);
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 2;
      ctx.stroke();
      
      // Magic sparkles
      for (let i = 0; i < 4; i++) {
        const angle = Math.PI/2 * i;
        const sparkX = x + Math.cos(angle) * iconSize/2.5;
        const sparkY = y - iconSize/2 + Math.sin(angle) * iconSize/2.5;
        
        ctx.beginPath();
        ctx.arc(sparkX, sparkY, 2, 0, Math.PI * 2);
        ctx.fillStyle = 'white';
        ctx.fill();
      }
      break;
      
    case 'healer':
      // Cross symbol
      ctx.beginPath();
      ctx.moveTo(x, y - iconSize/2);
      ctx.lineTo(x, y + iconSize/2);
      ctx.moveTo(x - iconSize/2, y);
      ctx.lineTo(x + iconSize/2, y);
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 2;
      ctx.stroke();
      break;
      
    default:
      // Default character letter
      ctx.font = 'bold 16px Arial';
      ctx.fillStyle = 'white';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(characterClass.charAt(0).toUpperCase(), x, y);
  }
  
  // Add a glow effect for current player
  if (isCurrentPlayer) {
    ctx.beginPath();
    ctx.arc(x, y, size + 3 + Math.sin(Date.now() / 200), 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

// Visual effects system with enhanced visual flair
function addEffect(x, y, type, team) {
  gameEffects.push({
    x: x,
    y: y,
    type: type,
    team: team,
    age: 0,
    maxAge: 30 // Longer duration for more visible effects
  });
}

function drawEffects() {
  if (!ctx) return;
  
  // Process each effect
  for (let i = gameEffects.length - 1; i >= 0; i--) {
    const effect = gameEffects[i];
    effect.age++;
    
    if (effect.age > effect.maxAge) {
      // Remove expired effects
      gameEffects.splice(i, 1);
      continue;
    }
    
    // Calculate effect properties
    const centerX = (effect.x + 0.5) * gridSize;
    const centerY = (effect.y + 0.5) * gridSize;
    const progress = effect.age / effect.maxAge;
    const radius = gridSize * (0.5 + progress * 1.5); // Larger expanding effect
    const alpha = 1 - progress;
    
    // Draw effect based on type
    if (effect.type === 'damage') {
      // Explosion effect for damage
      const innerRadius = radius * 0.6;
      
      // Outer explosion ring
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 100, 50, ${alpha * 0.3})`;
      ctx.fill();
      
      // Inner explosion
      ctx.beginPath();
      ctx.arc(centerX, centerY, innerRadius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 50, 0, ${alpha * 0.7})`;
      ctx.fill();
      
      // Random explosion particles
      for (let j = 0; j < 8; j++) {
        const angle = j * Math.PI / 4 + progress * Math.PI / 2;
        const distance = radius * 0.8 * progress;
        const particleX = centerX + Math.cos(angle) * distance;
        const particleY = centerY + Math.sin(angle) * distance;
        const particleSize = 3 + Math.random() * 4;
        
        ctx.beginPath();
        ctx.arc(particleX, particleY, particleSize, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, ${150 + Math.floor(Math.random() * 100)}, 0, ${alpha * 0.8})`;
        ctx.fill();
      }
      
    } else if (effect.type === 'heal') {
      // Healing light effect
      const glow = ctx.createRadialGradient(
        centerX, centerY, 0,
        centerX, centerY, radius
      );
      glow.addColorStop(0, `rgba(100, 255, 100, ${alpha * 0.8})`);
      glow.addColorStop(0.6, `rgba(50, 255, 50, ${alpha * 0.4})`);
      glow.addColorStop(1, `rgba(30, 200, 30, 0)`);
      
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      ctx.fillStyle = glow;
      ctx.fill();
      
      // Healing crosses
      for (let j = 0; j < 4; j++) {
        const angle = j * Math.PI / 2 + progress * Math.PI;
        const distance = radius * 0.7 * progress;
        const crossX = centerX + Math.cos(angle) * distance;
        const crossY = centerY + Math.sin(angle) * distance;
        const crossSize = gridSize * 0.2;
        
        // Draw cross
        ctx.beginPath();
        ctx.moveTo(crossX - crossSize/2, crossY);
        ctx.lineTo(crossX + crossSize/2, crossY);
        ctx.moveTo(crossX, crossY - crossSize/2);
        ctx.lineTo(crossX, crossY + crossSize/2);
        ctx.strokeStyle = `rgba(255, 255, 255, ${alpha * 0.9})`;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      
    } else if (effect.type === 'capture') {
      // Capture effect - fantasy style with magical circles
      
      // Expanding magical circle
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      
      if (effect.team === 'red') {
        ctx.fillStyle = `rgba(255, 0, 0, ${alpha * 0.2})`;
      } else {
        ctx.fillStyle = `rgba(0, 0, 255, ${alpha * 0.2})`;
      }
      ctx.fill();
      
      // Inner magical circle
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius * 0.7, 0, Math.PI * 2);
      if (effect.team === 'red') {
        ctx.strokeStyle = `rgba(255, 50, 50, ${alpha * 0.7})`;
      } else {
        ctx.strokeStyle = `rgba(50, 50, 255, ${alpha * 0.7})`;
      }
      ctx.lineWidth = 3;
      ctx.stroke();
      
      // Draw magical runes/symbols around circle
      const runeCount = 6;
      for (let j = 0; j < runeCount; j++) {
        const angle = j * (Math.PI * 2 / runeCount) + progress * Math.PI;
        const runeX = centerX + Math.cos(angle) * radius * 0.85;
        const runeY = centerY + Math.sin(angle) * radius * 0.85;
        
        ctx.fillStyle = effect.team === 'red' ? 
          `rgba(255, 200, 200, ${alpha * 0.9})` : 
          `rgba(200, 200, 255, ${alpha * 0.9})`;
          
        // Draw a small magical symbol
        ctx.beginPath();
        ctx.arc(runeX, runeY, 3, 0, Math.PI * 2);
        ctx.fill();
        
        // Connect runes with lines
        if (j > 0) {
          const prevAngle = (j-1) * (Math.PI * 2 / runeCount) + progress * Math.PI;
          const prevX = centerX + Math.cos(prevAngle) * radius * 0.85;
          const prevY = centerY + Math.sin(prevAngle) * radius * 0.85;
          
          ctx.beginPath();
          ctx.moveTo(prevX, prevY);
          ctx.lineTo(runeX, runeY);
          ctx.strokeStyle = effect.team === 'red' ? 
            `rgba(255, 150, 150, ${alpha * 0.5})` : 
            `rgba(150, 150, 255, ${alpha * 0.5})`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
      
      // Light beams from center
      for (let j = 0; j < 8; j++) {
        const angle = j * Math.PI / 4 + progress * Math.PI / 2;
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.lineTo(
          centerX + Math.cos(angle) * radius * 1.2,
          centerY + Math.sin(angle) * radius * 1.2
        );
        
        ctx.strokeStyle = effect.team === 'red' ? 
          `rgba(255, 100, 100, ${alpha * 0.3})` : 
          `rgba(100, 100, 255, ${alpha * 0.3})`;
        ctx.lineWidth = 2 + Math.sin(progress * Math.PI * 2) * 2;
        ctx.stroke();
      }
    }
  }
}

// Update the health bar UI
function updateHealthBar() {
  if (!currentClass) return;
  
  const maxHealth = CHARACTER_CLASSES[currentClass].health;
  const percent = (playerHealth / maxHealth) * 100;
  
  const healthFill = document.getElementById('health-fill');
  const healthText = document.getElementById('health-text');
  
  if (healthFill) {
    healthFill.style.width = `${percent}%`;
    
    // Set color based on health percentage
    let color;
    if (percent > 60) color = '#2ecc71';
    else if (percent > 30) color = '#f39c12';
    else color = '#e74c3c';
    
    healthFill.style.backgroundColor = color;
  }
  
  if (healthText) {
    healthText.textContent = `${playerHealth}/${maxHealth}`;
  }
}

// Update the cooldown indicator
function updateCooldownIndicator() {
  if (!currentClass || !actionCooldown) return;
  
  const cooldownElement = document.getElementById('cooldown-indicator');
  if (!cooldownElement) return;
  
  const elapsed = Date.now() - cooldownStartTime;
  const total = CHARACTER_CLASSES[currentClass].cooldown;
  const percent = Math.min(1, elapsed / total);
  
  // Update with radial gradient to show countdown
  cooldownElement.style.background = `conic-gradient(#666 ${percent * 360}deg, #333 0)`;
}

// Update the timer display
function updateTimerDisplay() {
  const minutes = Math.floor(timeRemaining / 60);
  const seconds = timeRemaining % 60;
  const timerText = `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  
  safelyUpdateElement('timer', timerText);
}

// Update score display
function updateScoreDisplay(scores) {
  if (!scores) return;
  
  // CRITICAL FIX: This was updating 'red-count' and 'blue-count',
  // but this is for game scores, not team counts
  // Team counts are updated through the 'teamCounts' event
  console.log("Updating game scores:", scores);
}

// Update status message
function updateStatus(message) {
  safelyUpdateElement('status-message', message);
}

// Request valid move and attack targets from server
function requestTargets() {
  if (socket && currentTeam && currentClass) {
    socket.emit('requestMoveTargets');
    socket.emit('requestAttackTargets');
  }
}