const express = require('express');
const http = require('http');
const socketio = require('socket.io');
const MongoClient = require('mongodb').MongoClient;

// Create express app and HTTP server
const app = express();
const server = http.createServer(app);
const io = socketio(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Serve static files
app.use(express.static('../'));

// Track teams - Make sure these are properly initialized
let redTeam = [];
let blueTeam = [];

// MongoDB connection
let db = null;
let mongoConnected = false;

// Try to connect to MongoDB
MongoClient.connect('mongodb://localhost:27017', { 
  useNewUrlParser: true,
  useUnifiedTopology: true 
}, function(err, client) {
  if (err) {
    console.log('MongoDB connection error:', err);
    console.log('Continuing without MongoDB integration');
    // Initialize game even if MongoDB fails
    ensureGameStateInitialized();
  } else {
    db = client.db('territoryControl');
    mongoConnected = true;
    console.log('Connected to MongoDB');
    
    // Initialize collections if they don't exist
    const collections = ['games', 'players', 'actions', 'captures'];
    let collectionsInitialized = 0;
    
    collections.forEach(collection => {
      db.createCollection(collection, (err) => {
        if (err && err.code !== 48) { // 48 is "collection already exists"
          console.error(`Error creating ${collection} collection:`, err);
        } else {
          collectionsInitialized++;
          if (collectionsInitialized === collections.length) {
            console.log('All MongoDB collections initialized');
            // Initialize game state after MongoDB is ready
            ensureGameStateInitialized();
          }
        }
      });
    });
  }
});

// Ensure game state is initialized even if MongoDB fails
function ensureGameStateInitialized() {
  if (!gameState.terrain || gameState.terrain.length === 0) {
    console.log("Game state not initialized or empty terrain, initializing now...");
    initializeGameState();
  }
}

// Game constants
const GRID_WIDTH = 30; // Expanded from 20
const GRID_HEIGHT = 20; // Expanded from 15
const MAX_PLAYERS_PER_TEAM = 20;
const GAME_DURATION = 30 * 60; // 30 minutes in seconds
const CONTROL_POINTS = [
  { id: 'A', x: 15, y: 10 }, // Center
  { id: 'B', x: 7, y: 5 },   // Top left
  { id: 'C', x: 22, y: 5 },  // Top right
  { id: 'D', x: 7, y: 15 },  // Bottom left
  { id: 'E', x: 22, y: 15 }  // Bottom right
];
const CHARACTER_CLASSES = {
  fighter: {
    health: 100,
    damage: 20,
    range: 1,
    moveRange: 3,
    cooldown: 2000 // ms
  },
  archer: {
    health: 70,
    damage: 10,
    range: 6,
    moveRange: 4,
    cooldown: 3000 // ms
  },
  magician: {
    health: 60,
    damage: 20,
    range: 3,
    moveRange: 2,
    cooldown: 5000 // ms
  },
  healer: {
    health: 80,
    damage: 5,
    healAmount: 15,
    range: 1,
    moveRange: 3,
    cooldown: 4000 // ms
  }
};

// Terrain types for the map
const TERRAIN_TYPES = {
  OPEN: 0,
  FOREST: 1,
  WATER: 2,
  MOUNTAIN: 3
};

// Game state
let gameState = {
  inProgress: false,
  gameId: null,
  startTime: null,
  timeRemaining: GAME_DURATION,
  redTeam: [],
  blueTeam: [],
  players: {},
  controlPoints: [],
  scores: { red: 0, blue: 0 },
  terrain: [], // Will hold terrain data
  teamCounts: { red: 0, blue: 0 } // Add explicit team counts
};

// Initialize game state
function initializeGameState() {
  gameState.inProgress = true;
  gameState.gameId = Date.now().toString();
  gameState.startTime = Date.now(); // Use timestamp instead of Date object
  gameState.timeRemaining = GAME_DURATION;
  gameState.scores = { red: 0, blue: 0 };
  
  // CRITICAL FIX: Reset team arrays at the start of a new game
  redTeam = [];
  blueTeam = [];
  gameState.redTeam = redTeam;
  gameState.blueTeam = blueTeam;
  gameState.teamCounts = { red: 0, blue: 0 };
  
  // Reset players object too
  gameState.players = {};
  
  // Generate terrain with a seed for stability
  console.log("Generating terrain...");
  gameState.terrain = generateTerrain(gameState.gameId);
  console.log("Terrain generation complete, grid size:", GRID_WIDTH, "x", GRID_HEIGHT);
  
  // Initialize control points
  gameState.controlPoints = CONTROL_POINTS.map(point => ({
    id: point.id,
    x: point.x,
    y: point.y,
    controllingTeam: null,
    captureProgress: { red: 0, blue: 0 }
  }));
  
  // Store new game in MongoDB only if connected
  if (mongoConnected && db) {
    try {
      db.collection('games').insertOne({
        gameId: gameState.gameId,
        startTime: new Date(gameState.startTime),
        status: 'in_progress'
      }, (err) => {
        if (err) {
          console.error("Error storing game in MongoDB:", err);
        } else {
          console.log("Game stored in MongoDB with ID:", gameState.gameId);
        }
      });
    } catch (err) {
      console.error("Failed to store game in MongoDB:", err);
    }
  } else {
    console.log("MongoDB not connected, skipping game storage");
  }
  
  console.log('Game initialized with ID:', gameState.gameId);
  console.log('Control points initialized:', gameState.controlPoints.length);
}

// Generate terrain for the map - using a seed for stability
function generateTerrain(seed) {
  console.log("Starting terrain generation with seed:", seed);
  try {
    // Convert seed to a numeric value to use for pseudo-random generation
    const numericSeed = parseInt(seed.substring(0, 10)) || Date.now();
    
    // Simple deterministic random function using the seed
    const seededRandom = (x, y) => {
      const val = Math.sin(x * 12.9898 + y * 78.233 + numericSeed) * 43758.5453;
      return val - Math.floor(val);
    };
    
    // Initialize terrain with all open spaces
    const terrain = Array(GRID_HEIGHT).fill().map(() => Array(GRID_WIDTH).fill(TERRAIN_TYPES.OPEN));
    
    console.log("Adding forest areas...");
    const forestAreas = [
      {x: 12, y: 7, w: 6, h: 6},  // Center forest
      {x: 3, y: 3, w: 5, h: 5},   // Upper left forest
      {x: 22, y: 3, w: 5, h: 5},  // Upper right forest
      {x: 3, y: 12, w: 5, h: 5},  // Lower left forest
      {x: 22, y: 12, w: 5, h: 5}  // Lower right forest
    ];
    
    // Place forests using deterministic approach
    forestAreas.forEach((area, areaIndex) => {
      for (let y = area.y; y < area.y + area.h; y++) {
        for (let x = area.x; x < area.x + area.w; x++) {
          if (y < GRID_HEIGHT && x < GRID_WIDTH) {
            // Use the seeded random function for deterministic placement
            if (seededRandom(x + areaIndex, y) < 0.7) { // 70% chance
              terrain[y][x] = TERRAIN_TYPES.FOREST;
            }
          }
        }
      }
    });
  
    // Add additional forest patches using same deterministic approach
    const forestPatches = [
      {x: 8, y: 8, w: 3, h: 3},
      {x: 19, y: 8, w: 3, h: 3},
      {x: 14, y: 15, w: 3, h: 3},
      {x: 14, y: 2, w: 3, h: 3}
    ];
    
    forestPatches.forEach((patch, patchIndex) => {
      for (let y = patch.y; y < patch.y + patch.h; y++) {
        for (let x = patch.x; x < patch.x + patch.w; x++) {
          if (y < GRID_HEIGHT && x < GRID_WIDTH) {
            if (seededRandom(x + patchIndex * 10, y + 100) < 0.6) { // 60% chance
              terrain[y][x] = TERRAIN_TYPES.FOREST;
            }
          }
        }
      }
    });
    
    // Add water features - river and lake
    const riverY = Math.floor(GRID_HEIGHT / 2);
    const riverWidth = 2;
    
    // Create a meandering river horizontally - deterministic pattern
    for (let x = 0; x < GRID_WIDTH; x++) {
      const yOffset = Math.sin(x * 0.5) * 2;
      const riverBaseY = riverY + Math.floor(yOffset);
      
      for (let w = 0; w < riverWidth; w++) {
        const y = riverBaseY + w;
        if (y >= 0 && y < GRID_HEIGHT) {
          terrain[y][x] = TERRAIN_TYPES.WATER;
        }
      }
    }
    
    // Add a lake - fixed position
    const lakeX = 24;
    const lakeY = 16;
    const lakeRadius = 3;
    
    for (let y = lakeY - lakeRadius; y <= lakeY + lakeRadius; y++) {
      for (let x = lakeX - lakeRadius; x <= lakeX + lakeRadius; x++) {
        if (y >= 0 && y < GRID_HEIGHT && x >= 0 && x < GRID_WIDTH) {
          const distance = Math.sqrt(Math.pow(x - lakeX, 2) + Math.pow(y - lakeY, 2));
          if (distance <= lakeRadius) {
            terrain[y][x] = TERRAIN_TYPES.WATER;
          }
        }
      }
    }
    
    // Add mountain barriers - deterministic pattern
    for (let y = 0; y < GRID_HEIGHT; y++) {
      if ((y % 5) !== 0) { // Create a pattern with 80% of positions
        const mountainX = GRID_WIDTH - 2;
        if (y < GRID_HEIGHT) {
          terrain[y][mountainX] = TERRAIN_TYPES.MOUNTAIN;
        }
      }
    }
    
    // Add strategic mountain barriers - fixed positions
    const mountainAreas = [
      {x: 7, y: 3, w: 2, h: 1},   // Near top left control point
      {x: 21, y: 3, w: 2, h: 1},  // Near top right control point
      {x: 7, y: 16, w: 2, h: 1},  // Near bottom left control point
      {x: 21, y: 16, w: 2, h: 1}, // Near bottom right control point
      {x: 13, y: 8, w: 4, h: 1},  // Barrier near center control point
      {x: 13, y: 11, w: 4, h: 1}  // Another barrier near center
    ];
    
    mountainAreas.forEach(area => {
      for (let y = area.y; y < area.y + area.h; y++) {
        for (let x = area.x; x < area.x + area.w; x++) {
          if (y < GRID_HEIGHT && x < GRID_WIDTH) {
            // Don't place mountains on control points
            const isControlPoint = CONTROL_POINTS.some(point => 
              point.x === x && point.y === y
            );
            
            if (!isControlPoint) {
              terrain[y][x] = TERRAIN_TYPES.MOUNTAIN;
            }
          }
        }
      }
    });
    
    // Add mountain clusters with deterministic approach
    const mountainClusters = [
      {x: 2, y: 2, radius: 2},   // Top left mountains
      {x: 27, y: 2, radius: 2},  // Top right mountains
      {x: 2, y: 17, radius: 2},  // Bottom left mountains
      {x: 27, y: 17, radius: 2}  // Bottom right mountains
    ];
    
    mountainClusters.forEach((cluster, clusterIndex) => {
      for (let y = cluster.y - cluster.radius; y <= cluster.y + cluster.radius; y++) {
        for (let x = cluster.x - cluster.radius; x <= cluster.x + cluster.radius; x++) {
          if (y >= 0 && y < GRID_HEIGHT && x >= 0 && x < GRID_WIDTH) {
            const distance = Math.sqrt(Math.pow(x - cluster.x, 2) + Math.pow(y - cluster.y, 2));
            // Use seeded random for deterministic mountains
            if (distance <= cluster.radius && seededRandom(x * 5 + clusterIndex, y * 7) < 0.7) {
              // Don't place mountains on control points
              const isControlPoint = CONTROL_POINTS.some(point => 
                point.x === x && point.y === y
              );
              
              if (!isControlPoint) {
                terrain[y][x] = TERRAIN_TYPES.MOUNTAIN;
              }
            }
          }
        }
      }
    });
    
    // Ensure control points are on open terrain and are accessible
    CONTROL_POINTS.forEach(point => {
      terrain[point.y][point.x] = TERRAIN_TYPES.OPEN;
      
      // Clear terrain around control points to ensure they're accessible
      for (let y = point.y - 1; y <= point.y + 1; y++) {
        for (let x = point.x - 1; x <= point.x + 1; x++) {
          if (y >= 0 && y < GRID_HEIGHT && x >= 0 && x < GRID_WIDTH) {
            // Water and mountains can't be traversed
            if (terrain[y][x] === TERRAIN_TYPES.WATER || terrain[y][x] === TERRAIN_TYPES.MOUNTAIN) {
              terrain[y][x] = TERRAIN_TYPES.OPEN;
            }
          }
        }
      }
    });
    
    // Clear team starting areas
    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < 4; x++) {
        // Red team starting area (left side)
        terrain[y][x] = TERRAIN_TYPES.OPEN;
      }
      
      for (let x = GRID_WIDTH - 4; x < GRID_WIDTH; x++) {
        // Blue team starting area (right side)
        terrain[y][x] = TERRAIN_TYPES.OPEN;
      }
    }
    
    // Count terrain distribution
    let terrainCounts = {
      "Open": 0,
      "Forest": 0,
      "Water": 0,
      "Mountain": 0
    };
    
    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        switch(terrain[y][x]) {
          case TERRAIN_TYPES.OPEN: terrainCounts.Open++; break;
          case TERRAIN_TYPES.FOREST: terrainCounts.Forest++; break;
          case TERRAIN_TYPES.WATER: terrainCounts.Water++; break;
          case TERRAIN_TYPES.MOUNTAIN: terrainCounts.Mountain++; break;
        }
      }
    }
    console.log("Terrain generation successful! Distribution:", terrainCounts);
    
    return terrain;
  } catch (error) {
    console.error("Error generating terrain:", error);
    // Return a simple fallback terrain if there's an error
    console.log("Using fallback terrain due to error");
    return generateFallbackTerrain();
  }
}

// Fallback terrain generator
function generateFallbackTerrain() {
  const fallbackTerrain = Array(GRID_HEIGHT).fill().map(() => Array(GRID_WIDTH).fill(TERRAIN_TYPES.OPEN));
  
  // Add some basic deterministic terrain features
  for (let y = 0; y < GRID_HEIGHT; y++) {
    for (let x = 0; x < GRID_WIDTH; x++) {
      // Add forests in a pattern
      if ((x + y) % 7 === 0) {
        fallbackTerrain[y][x] = TERRAIN_TYPES.FOREST;
      }
      // Add water in a simple pattern
      if ((x + y) % 13 === 0) {
        fallbackTerrain[y][x] = TERRAIN_TYPES.WATER;
      }
      // Add mountains in a simple pattern
      if ((x * y) % 29 === 0) {
        fallbackTerrain[y][x] = TERRAIN_TYPES.MOUNTAIN;
      }
    }
  }
  
  // Clear team starting areas
  for (let y = 0; y < GRID_HEIGHT; y++) {
    for (let x = 0; x < 4; x++) {
      // Red team starting area
      fallbackTerrain[y][x] = TERRAIN_TYPES.OPEN;
    }
    
    for (let x = GRID_WIDTH - 4; x < GRID_WIDTH; x++) {
      // Blue team starting area
      fallbackTerrain[y][x] = TERRAIN_TYPES.OPEN;
    }
  }
  
  return fallbackTerrain;
}

// Update game timer
function updateGameTimer() {
  if (!gameState.inProgress) return;
  
  const now = Date.now();
  const elapsedSeconds = Math.floor((now - gameState.startTime) / 1000);
  gameState.timeRemaining = Math.max(0, GAME_DURATION - elapsedSeconds);
  
  // Check if game should end
  if (gameState.timeRemaining <= 0) {
    endGame();
  }
}

// Update and broadcast team counts
function updateTeamCounts() {
  const redCount = redTeam.length;
  const blueCount = blueTeam.length;
  
  // Update the counts in the game state
  gameState.teamCounts = { red: redCount, blue: blueCount };
  
  // Log current counts
  console.log(`TEAM COUNTS - Red: ${redCount}, Blue: ${blueCount}`);
  
  // Broadcast to all clients
  io.emit('teamCounts', {
    red: redCount,
    blue: blueCount
  });
}

// Get starting position for a player based on team
function getStartingPosition(team) {
  if (team === 'red') {
    return {
      x: Math.floor(Math.random() * 4) + 1,
      y: Math.floor(Math.random() * (GRID_HEIGHT - 2)) + 1
    };
  } else {
    return {
      x: Math.floor(Math.random() * 4) + (GRID_WIDTH - 5),
      y: Math.floor(Math.random() * (GRID_HEIGHT - 2)) + 1
    };
  }
}

// Calculate distance between two points
function calculateDistance(x1, y1, x2, y2) {
  return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
}

// Check if a position is valid for movement
function isValidPosition(x, y, playerId) {
  // Check grid boundaries
  if (x < 0 || x >= GRID_WIDTH || y < 0 || y >= GRID_HEIGHT) {
    return false;
  }
  
  // Check if position is occupied by another player
  for (const id in gameState.players) {
    if (id !== playerId) {
      const player = gameState.players[id];
      if (player.x === x && player.y === y && !player.isDead) {
        return false;
      }
    }
  }
  
  // Check terrain (can't move into water or mountain)
  if (gameState.terrain && gameState.terrain[y] && 
      (gameState.terrain[y][x] === TERRAIN_TYPES.WATER || 
       gameState.terrain[y][x] === TERRAIN_TYPES.MOUNTAIN)) {
    return false;
  }
  
  return true;
}

// Calculate line of sight for attack/movement using deterministic approach
function hasLineOfSight(x1, y1, x2, y2) {
  // Bresenham's line algorithm to check for obstacles
  const dx = Math.abs(x2 - x1);
  const dy = Math.abs(y2 - y1);
  const sx = (x1 < x2) ? 1 : -1;
  const sy = (y1 < y2) ? 1 : -1;
  let err = dx - dy;
  
  let currentX = x1;
  let currentY = y1;
  
  while (currentX !== x2 || currentY !== y2) {
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      currentX += sx;
    }
    if (e2 < dx) {
      err += dx;
      currentY += sy;
    }
    
    // Skip the starting and ending points
    if (currentX === x1 && currentY === y1) continue;
    if (currentX === x2 && currentY === y2) continue;
    
    // Check for obstacles (mountain terrain blocks line of sight)
    if (gameState.terrain && gameState.terrain[currentY] && 
        gameState.terrain[currentY][currentX] === TERRAIN_TYPES.MOUNTAIN) {
      return false;
    }
    
    // In forest, there's a deterministic chance to block line of sight
    if (gameState.terrain && gameState.terrain[currentY] && 
        gameState.terrain[currentY][currentX] === TERRAIN_TYPES.FOREST) {
      // Use a deterministic approach based on the coordinates
      const blockChance = (currentX * 31 + currentY * 17) % 10;
      if (blockChance < 3) { // 30% chance
        return false;
      }
    }
  }
  
  return true;
}

// Get valid move targets for a player
function getValidMoveTargets(player) {
  if (!player || player.isDead) return [];
  
  const targets = [];
  const moveRange = CHARACTER_CLASSES[player.class].moveRange;
  
  // Check all positions within move range
  for (let y = Math.max(0, player.y - moveRange); y <= Math.min(GRID_HEIGHT - 1, player.y + moveRange); y++) {
    for (let x = Math.max(0, player.x - moveRange); x <= Math.min(GRID_WIDTH - 1, player.x + moveRange); x++) {
      const distance = calculateDistance(player.x, player.y, x, y);
      if (distance <= moveRange && isValidPosition(x, y, player.id)) {
        // Check line of sight for movement
        if (hasLineOfSight(player.x, player.y, x, y)) {
          targets.push({ x, y });
        }
      }
    }
  }
  
  return targets;
}

// Get valid attack targets for a player
function getValidAttackTargets(player) {
  if (!player || player.isDead) return [];
  
  const targets = [];
  const actionRange = CHARACTER_CLASSES[player.class].range;
  
  // Check all players for valid targets
  for (const id in gameState.players) {
    if (id === player.id) continue; // Skip self
    
    const potentialTarget = gameState.players[id];
    if (potentialTarget.isDead) continue; // Skip dead players
    
    // For healers, only allies are valid targets
    if (player.class === 'healer' && potentialTarget.team !== player.team) {
      continue;
    }
    
    // For non-healers or healers attacking, only enemies are valid targets
    if (player.class !== 'healer' && potentialTarget.team === player.team) {
      continue;
    }
    
    // Check range
    const distance = calculateDistance(player.x, player.y, potentialTarget.x, potentialTarget.y);
    if (distance <= actionRange) {
      // Check line of sight
      if (hasLineOfSight(player.x, player.y, potentialTarget.x, potentialTarget.y)) {
        targets.push({
          id: id,
          x: potentialTarget.x,
          y: potentialTarget.y,
          team: potentialTarget.team
        });
      }
    }
  }
  
  return targets;
}

// Handle player movement
function handlePlayerMove(playerId, x, y) {
  const player = gameState.players[playerId];
  if (!player || player.isDead) return false;
  
  // Check if the move is within range
  const moveRange = CHARACTER_CLASSES[player.class].moveRange;
  const distance = calculateDistance(player.x, player.y, x, y);
  
  if (distance > moveRange) {
    return false;
  }
  
  // Check if the position is valid
  if (!isValidPosition(x, y, playerId)) {
    return false;
  }
  
  // Check line of sight for movement
  if (!hasLineOfSight(player.x, player.y, x, y)) {
    return false;
  }
  
  // Move the player
  player.x = x;
  player.y = y;
  
  // Broadcast move to all players for consistency
  io.emit('playerMoved', {
    id: playerId,
    x: x,
    y: y
  });
  
  return true;
}

// Handle player action (attack or heal)
function handlePlayerAction(playerId, targetX, targetY) {
  const player = gameState.players[playerId];
  if (!player || player.isDead) return { success: false, reason: 'not_available' };
  
  // Check cooldown
  const now = Date.now();
  if (player.lastActionTime && now - player.lastActionTime < CHARACTER_CLASSES[player.class].cooldown) {
    return { success: false, reason: 'cooldown' };
  }
  
  // Calculate distance to target
  const distance = calculateDistance(player.x, player.y, targetX, targetY);
  const actionRange = CHARACTER_CLASSES[player.class].range;
  
  if (distance > actionRange) {
    return { success: false, reason: 'out_of_range' };
  }
  
  // Check line of sight
  if (!hasLineOfSight(player.x, player.y, targetX, targetY)) {
    return { success: false, reason: 'no_line_of_sight' };
  }
  
  // Find target at position
  let targetId = null;
  for (const id in gameState.players) {
    const potentialTarget = gameState.players[id];
    if (potentialTarget.x === targetX && potentialTarget.y === targetY && !potentialTarget.isDead) {
      targetId = id;
      break;
    }
  }
  
  if (!targetId) {
    return { success: false, reason: 'no_target' };
  }
  
  const target = gameState.players[targetId];
  
  // Healer targeting ally
  if (player.class === 'healer' && target.team === player.team) {
    const healAmount = CHARACTER_CLASSES.healer.healAmount;
    const maxHealth = CHARACTER_CLASSES[target.class].health;
    
    // Don't heal if at max health
    if (target.health >= maxHealth) {
      return { success: false, reason: 'target_full_health' };
    }
    
    // Apply healing
    target.health = Math.min(maxHealth, target.health + healAmount);
    player.lastActionTime = now;
    
    // Log action to MongoDB if connected
    if (mongoConnected && db) {
      try {
        db.collection('actions').insertOne({
          gameId: gameState.gameId,
          action: 'heal',
          playerId: playerId,
          targetId: targetId,
          amount: healAmount,
          timestamp: new Date()
        });
      } catch (err) {
        console.error("MongoDB error logging heal action:", err);
      }
    }
    
    return {
      success: true,
      type: 'heal',
      targetId: targetId,
      amount: healAmount
    };
  }
  
  // Attack logic (either non-healer or healer targeting enemy)
  if (target.team !== player.team) {
    const damage = CHARACTER_CLASSES[player.class].damage;
    
    // Apply damage
    target.health = Math.max(0, target.health - damage);
    player.lastActionTime = now;
    
    // Check if target died
    let killed = false;
    if (target.health <= 0) {
      target.isDead = true;
      target.respawnTime = now + 10000; // 10 second respawn
      killed = true;
      
      // Don't remove from team arrays on death - we'll handle this in checkRespawns
      // This way they still count toward their team until they respawn or disconnect
      
      // Update team counts but don't modify the arrays
      // Just broadcast the updated counts
      updateTeamCounts();
    }
    
    // Log action to MongoDB if connected
    if (mongoConnected && db) {
      try {
        db.collection('actions').insertOne({
          gameId: gameState.gameId,
          action: 'attack',
          playerId: playerId,
          targetId: targetId,
          damage: damage,
          killed: killed,
          timestamp: new Date()
        });
      } catch (err) {
        console.error("MongoDB error logging attack action:", err);
      }
    }
    
    return {
      success: true,
      type: 'attack',
      targetId: targetId,
      damage: damage,
      killed: killed
    };
  }
  
  return { success: false, reason: 'invalid_target' };
}

// Update control points (called every second)
function updateControlPoints() {
  if (!gameState.controlPoints || !Array.isArray(gameState.controlPoints) || gameState.controlPoints.length === 0) {
    console.log("No control points found, reinitializing...");
    gameState.controlPoints = CONTROL_POINTS.map(point => ({
      id: point.id,
      x: point.x,
      y: point.y,
      controllingTeam: null,
      captureProgress: { red: 0, blue: 0 }
    }));
    return;
  }

  gameState.controlPoints.forEach(point => {
    // Count players from each team near control point
    let redCount = 0;
    let blueCount = 0;
    
    for (const id in gameState.players) {
      const player = gameState.players[id];
      if (!player.isDead) {
        // Check if player is within capture range (2 squares)
        const distance = calculateDistance(player.x, player.y, point.x, point.y);
        if (distance <= 2) {
          if (player.team === 'red') redCount++;
          else blueCount++;
        }
      }
    }
    
    // Only log active capture points
    if (redCount > 0 || blueCount > 0) {
      console.log(`Point ${point.id} - Red: ${redCount}, Blue: ${blueCount}, Progress R: ${point.captureProgress.red.toFixed(1)}%, B: ${point.captureProgress.blue.toFixed(1)}%`);
    }
    
    // Update capture progress
    if (redCount > blueCount) {
      // Red team capturing - takes 60 seconds to capture (100/60 = 1.67% per second)
      point.captureProgress.red = Math.min(100, point.captureProgress.red + (100/60));
      point.captureProgress.blue = Math.max(0, point.captureProgress.blue - (100/30)); // Decay twice as fast
      
      // Check if capture complete
      if (point.captureProgress.red >= 100 && point.controllingTeam !== 'red') {
        point.controllingTeam = 'red';
        point.captureProgress.red = 100;
        point.captureProgress.blue = 0; // Reset other team progress
        gameState.scores.red++;
        
        // Log capture to MongoDB if connected
        if (mongoConnected && db) {
          try {
            db.collection('captures').insertOne({
              gameId: gameState.gameId,
              pointId: point.id,
              team: 'red',
              timestamp: new Date()
            });
          } catch (err) {
            console.error("MongoDB error logging capture:", err);
          }
        }
        
        // Broadcast capture event
        io.emit('pointCaptured', {
          pointId: point.id,
          team: 'red'
        });
        
        console.log(`RED TEAM CAPTURED POINT ${point.id}! Red now controls ${gameState.controlPoints.filter(p => p.controllingTeam === 'red').length} points`);
      }
    } else if (blueCount > redCount) {
      // Blue team capturing - takes 60 seconds to capture
      point.captureProgress.blue = Math.min(100, point.captureProgress.blue + (100/60));
      point.captureProgress.red = Math.max(0, point.captureProgress.red - (100/30));
      
      // Check if capture complete
      if (point.captureProgress.blue >= 100 && point.controllingTeam !== 'blue') {
        point.controllingTeam = 'blue';
        point.captureProgress.blue = 100;
        point.captureProgress.red = 0; // Reset other team progress
        gameState.scores.blue++;
        
        // Log capture to MongoDB if connected
        if (mongoConnected && db) {
          try {
            db.collection('captures').insertOne({
              gameId: gameState.gameId,
              pointId: point.id,
              team: 'blue',
              timestamp: new Date()
            });
          } catch (err) {
            console.error("MongoDB error logging capture:", err);
          }
        }
        
        // Broadcast capture event
        io.emit('pointCaptured', {
          pointId: point.id,
          team: 'blue'
        });
        
        console.log(`BLUE TEAM CAPTURED POINT ${point.id}! Blue now controls ${gameState.controlPoints.filter(p => p.controllingTeam === 'blue').length} points`);
      }
    } else {
      // If counts are equal, both teams' capture progress degrades
      point.captureProgress.red = Math.max(0, point.captureProgress.red - (100/30));
      point.captureProgress.blue = Math.max(0, point.captureProgress.blue - (100/30));
    }
  });
  
  // Check victory conditions
  checkVictoryConditions();
}

// Check for players that need to respawn
function checkRespawns() {
  const now = Date.now();
  
  for (const id in gameState.players) {
    const player = gameState.players[id];
    if (player.isDead && player.respawnTime && now >= player.respawnTime) {
      // Respawn player
      player.isDead = false;
      player.health = CHARACTER_CLASSES[player.class].health;
      
      // Place at team starting area
      const startPos = getStartingPosition(player.team);
      player.x = startPos.x;
      player.y = startPos.y;
      
      // IMPORTANT: Ensure player is in their team array when they respawn
      // This is critical to maintain accurate team counts
      if (player.team === 'red' && !redTeam.includes(id)) {
        redTeam.push(id);
        gameState.redTeam = redTeam;
      } else if (player.team === 'blue' && !blueTeam.includes(id)) {
        blueTeam.push(id);
        gameState.blueTeam = blueTeam;
      }
      
      // Update and broadcast team counts
      updateTeamCounts();
      
      // Notify player they've respawned
      io.to(id).emit('respawn', {
        x: player.x,
        y: player.y,
        health: player.health
      });
    }
  }
}

// Check if a team has won
function checkVictoryConditions() {
  // Update timer
  updateGameTimer();
  
  // Check if time has expired
  if (gameState.timeRemaining <= 0) {
    endGame();
    return;
  }
  
  // Check if a team has captured all 5 points
  const redControlled = gameState.controlPoints.filter(p => p.controllingTeam === 'red').length;
  const blueControlled = gameState.controlPoints.filter(p => p.controllingTeam === 'blue').length;
  
  // Win if team controls all 5 points
  if (redControlled === 5) {
    endGame('red');
  } else if (blueControlled === 5) {
    endGame('blue');
  }
}

// End the current game
function endGame(winner) {
  gameState.inProgress = false;
  
  // Determine winner if not specified (time expired)
  if (!winner) {
    const redControlled = gameState.controlPoints.filter(p => p.controllingTeam === 'red').length;
    const blueControlled = gameState.controlPoints.filter(p => p.controllingTeam === 'blue').length;
    
    if (redControlled > blueControlled) {
      winner = 'red';
    } else if (blueControlled > redControlled) {
      winner = 'blue';
    } else {
      winner = 'tie';
    }
  }
  
  // Update game in MongoDB if connected
  if (mongoConnected && db) {
    try {
      db.collection('games').updateOne(
        { gameId: gameState.gameId },
        { 
          $set: {
            endTime: new Date(),
            status: 'completed',
            winner: winner,
            finalScores: gameState.scores,
            redTeamSize: redTeam.length,
            blueTeamSize: blueTeam.length
          }
        }
      );
    } catch (err) {
      console.error("MongoDB error updating game end:", err);
    }
  }
  
  // Send game results to all clients
  io.emit('gameEnd', {
    winner: winner,
    redScore: gameState.scores.red,
    blueScore: gameState.scores.blue,
    controlPoints: gameState.controlPoints
  });
  
  console.log(`Game ended. Winner: ${winner}, Red: ${gameState.scores.red}, Blue: ${gameState.scores.blue}`);
  
  // Start a new game in 30 seconds
  setTimeout(() => {
    initializeGameState();
    io.emit('newGame', {
      timeRemaining: gameState.timeRemaining,
      controlPoints: gameState.controlPoints,
      scores: gameState.scores,
      terrain: gameState.terrain,
      gameId: gameState.gameId,
      teamCounts: gameState.teamCounts // Include team counts in new game event
    });
  }, 30000);
}

// Socket.io connection handling
io.on('connection', function(socket) {
  console.log('Client connected:', socket.id);
  
  // Make sure we have game state initialized
  ensureGameStateInitialized();
  
  // Debug information about terrain before sending
  console.log("Terrain size being sent:", 
              gameState.terrain ? `${gameState.terrain.length}x${gameState.terrain[0]?.length}` : "no terrain");
  
  // Send initial game state
  socket.emit('gameState', {
    inProgress: gameState.inProgress,
    timeRemaining: gameState.timeRemaining,
    controlPoints: gameState.controlPoints,
    scores: gameState.scores,
    teamCounts: gameState.teamCounts, // Include team counts
    terrain: gameState.terrain,
    gridWidth: GRID_WIDTH,
    gridHeight: GRID_HEIGHT,
    gameId: gameState.gameId
  });
  
  // Send current player list
  const playerList = Object.values(gameState.players).map(p => ({
    id: p.id,
    team: p.team,
    class: p.class,
    x: p.x,
    y: p.y,
    health: p.health,
    isDead: p.isDead
  }));
  socket.emit('playerList', playerList);
  
  // Send current team counts
  socket.emit('teamCounts', {
    red: redTeam.length,
    blue: blueTeam.length
  });
  
  // Handle debug request for game state
  socket.on('requestGameState', function() {
    console.log("Game state requested by client:", socket.id);
    socket.emit('gameState', {
      inProgress: gameState.inProgress,
      timeRemaining: gameState.timeRemaining,
      controlPoints: gameState.controlPoints,
      scores: gameState.scores,
      teamCounts: gameState.teamCounts, // Include team counts
      terrain: gameState.terrain,
      gridWidth: GRID_WIDTH,
      gridHeight: GRID_HEIGHT,
      gameId: gameState.gameId
    });
    
    console.log("Server time remaining:", gameState.timeRemaining);
    console.log("Control points:", gameState.controlPoints.length);
    console.log("Players:", Object.keys(gameState.players).length);
    console.log("Red team:", redTeam.length);
    console.log("Blue team:", blueTeam.length);
    console.log("Team counts:", gameState.teamCounts);
  });
  
  // Handle request for valid move targets
  socket.on('requestMoveTargets', function() {
    const player = gameState.players[socket.id];
    if (player) {
      const targets = getValidMoveTargets(player);
      socket.emit('moveTargets', targets);
    }
  });

  // Handle terrain regeneration request
  socket.on('regenerateTerrain', function() {
    console.log("Terrain regeneration requested by client:", socket.id);
    
    // Regenerate terrain with new seed for different layout
    const newSeed = Date.now().toString();
    gameState.terrain = generateTerrain(newSeed);
    
    // Send updated terrain to all clients
    io.emit('terrainUpdated', gameState.terrain);
    console.log("Regenerated terrain sent to all clients");
  });

  // Handle request for valid attack targets
  socket.on('requestAttackTargets', function() {
    const player = gameState.players[socket.id];
    if (player) {
      const targets = getValidAttackTargets(player);
      socket.emit('attackTargets', targets);
    }
  });
  
  // Handle team join request
  socket.on('joinTeam', function(team) {
    console.log('TEAM JOIN ATTEMPT: Player ' + socket.id + ' trying to join team ' + team);
    
    if (team !== 'red' && team !== 'blue') {
      socket.emit('error', 'Invalid team');
      return;
    }
    
    // Check team size limits
    if (team === 'red' && redTeam.length >= MAX_PLAYERS_PER_TEAM) {
      socket.emit('error', 'Red team is full');
      return;
    }
    
    if (team === 'blue' && blueTeam.length >= MAX_PLAYERS_PER_TEAM) {
      socket.emit('error', 'Blue team is full');
      return;
    }
    
    // Remove from any existing team
    redTeam = redTeam.filter(id => id !== socket.id);
    blueTeam = blueTeam.filter(id => id !== socket.id);
    
    // Add to selected team
    if (team === 'red') {
      redTeam.push(socket.id);
      gameState.redTeam = redTeam; // Keep gameState in sync
    } else {
      blueTeam.push(socket.id);
      gameState.blueTeam = blueTeam; // Keep gameState in sync
    }
    
    socket.team = team;
    socket.emit('teamJoined', team);
    
    // Update and broadcast team counts to ALL clients
    updateTeamCounts();
    
    console.log(`Player ${socket.id} joined ${team} team. Red: ${redTeam.length}, Blue: ${blueTeam.length}`);
  });
  
  // Handle class selection
  socket.on('selectClass', function(className) {
    if (!socket.team) {
      socket.emit('error', 'Must join a team first');
      return;
    }
    
    if (!CHARACTER_CLASSES[className]) {
      socket.emit('error', 'Invalid class');
      return;
    }
    
    // Set starting position
    const startPos = getStartingPosition(socket.team);
    
    // Create player object
    gameState.players[socket.id] = {
      id: socket.id,
      team: socket.team,
      class: className,
      x: startPos.x,
      y: startPos.y,
      health: CHARACTER_CLASSES[className].health,
      isDead: false,
      respawnTime: 0,
      lastActionTime: 0
    };
    
    // Store in MongoDB if connected
    if (mongoConnected && db) {
      try {
        db.collection('players').updateOne(
          { playerId: socket.id },
          {
            $set: {
              team: socket.team,
              class: className,
              joinTime: new Date(),
              gameId: gameState.gameId
            }
          },
          { upsert: true }
        );
      } catch (err) {
        console.error("MongoDB error storing player:", err);
      }
    }
    
    // Get initial valid targets
    const moveTargets = getValidMoveTargets(gameState.players[socket.id]);
    const attackTargets = getValidAttackTargets(gameState.players[socket.id]);
    
    // Send position and targets to player
    socket.emit('classSelected', {
      class: className,
      x: startPos.x,
      y: startPos.y,
      health: CHARACTER_CLASSES[className].health,
      moveTargets: moveTargets,
      attackTargets: attackTargets
    });
    
    // Broadcast updated player list
    io.emit('playerJoined', {
      id: socket.id,
      team: socket.team,
      class: className,
      x: startPos.x,
      y: startPos.y,
      health: CHARACTER_CLASSES[className].health
    });
    
    console.log(`Player ${socket.id} selected class ${className}`);
  });
  
  // Handle movement request
  socket.on('move', function(data) {
    if (!gameState.players[socket.id]) return;
    
    if (handlePlayerMove(socket.id, data.x, data.y)) {
      // Get updated targets after move
      const moveTargets = getValidMoveTargets(gameState.players[socket.id]);
      const attackTargets = getValidAttackTargets(gameState.players[socket.id]);
      
      // Send updated targets to player
      socket.emit('playerMoveResult', {
        success: true,
        x: data.x,
        y: data.y,
        moveTargets: moveTargets,
        attackTargets: attackTargets
      });
    } else {
      socket.emit('playerMoveResult', {
        success: false,
        reason: 'invalid_move'
      });
    }
  });
  
  // Handle action request (attack/heal)
  socket.on('action', function(data) {
    if (!gameState.players[socket.id]) return;
    
    const result = handlePlayerAction(socket.id, data.x, data.y);
    
    if (result.success) {
      // Get updated targets
      const moveTargets = getValidMoveTargets(gameState.players[socket.id]);
      const attackTargets = getValidAttackTargets(gameState.players[socket.id]);
      
      // Send updated information to player
      socket.emit('actionConfirmed', {
        ...result,
        moveTargets: moveTargets,
        attackTargets: attackTargets
      });
      
      // Broadcast action result to all clients
      io.emit('actionResult', {
        sourceId: socket.id,
        ...result
      });
    } else {
      // Inform player of failed action
      socket.emit('actionFailed', result);
    }
  });
  
  // Handle disconnection
  socket.on('disconnect', function() {
    console.log('Client disconnected:', socket.id);
    
    // IMPORTANT: Remove from team arrays to maintain correct counts
    redTeam = redTeam.filter(id => id !== socket.id);
    blueTeam = blueTeam.filter(id => id !== socket.id);
    
    // Keep gameState in sync
    gameState.redTeam = redTeam;
    gameState.blueTeam = blueTeam;
    
    // Remove player from game
    if (gameState.players[socket.id]) {
      // Update player record in MongoDB if connected
      if (mongoConnected && db) {
        try {
          db.collection('players').updateOne(
            { playerId: socket.id },
            { $set: { disconnectTime: new Date() } }
          );
        } catch (err) {
          console.error("MongoDB error updating player disconnect:", err);
        }
      }
      
      delete gameState.players[socket.id];
      
      // Notify other clients
      io.emit('playerLeft', socket.id);
    }
    
    // Update team counts after player disconnects
    updateTeamCounts();
  });
});

// Game loop - runs every second
setInterval(function() {
  if (gameState.inProgress) {
    // Update game timer
    updateGameTimer();
    
    // Update control points
    updateControlPoints();
    
    // Check for respawns
    checkRespawns();
    
    // Update team counts based on team arrays
    // We don't modify team arrays in this game loop - only when players join/leave/respawn
    gameState.teamCounts = {
      red: redTeam.length,
      blue: blueTeam.length
    };
    
    // Broadcast game state updates to all clients
    io.emit('gameUpdate', {
      timeRemaining: gameState.timeRemaining,
      controlPoints: gameState.controlPoints,
      scores: gameState.scores,
      teamCounts: gameState.teamCounts  // Include team counts in every update
    });
    
    // Log game state periodically (every minute)
    if (gameState.timeRemaining % 60 === 0) {
      console.log(`Game time remaining: ${Math.floor(gameState.timeRemaining/60)}:${gameState.timeRemaining%60 < 10 ? '0' : ''}${gameState.timeRemaining%60}`);
      console.log(`Scores - Red: ${gameState.scores.red}, Blue: ${gameState.scores.blue}`);
      console.log(`Players: ${Object.keys(gameState.players).length}, Red team: ${redTeam.length}, Blue team: ${blueTeam.length}`);
    }
  }
}, 1000);

// Start the server
const PORT = 3000;
server.listen(PORT, function() {
  console.log('Server running on port ' + PORT);
});