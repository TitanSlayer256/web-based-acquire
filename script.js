// These variables hold the game's changing state. The browser keeps this state
// in memory for the current page session; refreshing the page starts over.
let playerCount; // Number of players selected on the start screen.
let playerData = []; // Player records: names, cash, shares, and tiles in hand.
let gameBoardWidth = 12; // The board has twelve numbered columns.
let gameBoardHeight = 9; // The board has nine lettered rows.
let rowLetter = ["A", "B", "C", "D", "E", "F", "G", "H", "I"]; // Row labels used in tile names, such as 3C.
let gameBoard = []; // One object for every tile space, including its owner and status.
let smallInformation = []; // Share prices and bonuses for small companies by size.
let mediumInformation = []; // Share prices and bonuses for medium companies by size.
let largeInformation = []; // Share prices and bonuses for large companies by size.
let companies = []; // The seven companies and their current size, price, and shares.
let gameOver = false; // Prevents further play once final scoring has happened.
let currentPlayerIndex = 0; // Index into playerData for the player whose turn it is.
let selectedTileName = null; // Name of the hand tile currently selected for placement.
let pendingTurn = false; // True while a player must finish buying shares or resolving a merger.
let mergerState = null; // Temporary information needed while resolving a merger.
const title = document.getElementById("title"); // Cache the page heading so start/reset can change it.
const HOST_GAME_SAVE_KEY = "acquire.host.game.v1";
const HOST_ROOM_SESSION_KEY = "acquire.host.room.v1";
let finalSettlement = [];
// Network state is a thin transport around the existing laptop-side game logic.
const phoneJoinCode = new URLSearchParams(window.location.search).get("join");
const isPhoneClient = Boolean(phoneJoinCode);
let networkEnabled = false;
let networkRoomCode = "";
let networkHostToken = "";
let remotePlayers = [];
let lobbyRosterSignature = null;
let lobbyPlayerTiles = new Map();
let hostEventSource = null;
let phoneEventSource = null;
let phoneToken = "";
let phoneDeviceId = "";
let phoneState = null;
let phoneSelectedTile = null;
let phoneSelectedCompany = null;
let phoneStockSelections = {};
let phoneMergerSelections = { sell: 0, tradeShares: 0 };
let phoneBusy = false;
let phoneActionWaiter = null;
let phoneError = "";
let phoneFormContext = "";
let phonePointerActive = false;
let phoneRenderDeferred = false;
let remoteCompanyChoice = null;
let networkPublishTimer = null;
let networkSnapshotRevision = 0;

// These colors are shared by board tiles, hand previews, and company markers.
const companyColors = {
    sackson: "#e57373",
    zeta: "#f4d35e",
    america: "#64b5f6",
    fusion: "#81c784",
    hydra: "#ffb74d",
    phoenix: "#ba68c8",
    quantum: "#4db6ac"
};

// Capitalize company names for people while keeping their lowercase IDs stable in game data.
function companyDisplayName(name) {
    return name ? name.charAt(0).toUpperCase() + name.slice(1) : "";
}

function readSavedHostGame() {
    try {
        const saved = JSON.parse(localStorage.getItem(HOST_GAME_SAVE_KEY) || "null");
        return saved?.version === 1 && Array.isArray(saved.gameBoard) && Array.isArray(saved.playerData) ? saved : null;
    } catch (error) {
        console.error("Could not read the saved Acquire game.", error);
        return null;
    }
}

function readHostRoomSession() {
    try { return JSON.parse(localStorage.getItem(HOST_ROOM_SESSION_KEY) || "null"); }
    catch (error) { console.error("Could not read the saved host room.", error); return null; }
}

function persistHostGame() {
    if (isPhoneClient || !networkEnabled || !playerData.length || (remoteCompanyChoice && !mergerState)) return;
    try {
        localStorage.setItem(HOST_GAME_SAVE_KEY, JSON.stringify({
            version: 1,
            savedAt: Date.now(),
            playerCount,
            gameBoard,
            playerData,
            companies,
            currentPlayerIndex,
            pendingTurn,
            gameOver,
            finalSettlement,
            mergerState: mergerState ? {
                ...mergerState,
                playerOrder: undefined,
                playerOrderIds: (mergerState.playerOrder || []).map(player => player.id)
            } : null
        }));
    } catch (error) {
        console.error("Could not save the Acquire game.", error);
        const status = document.getElementById("networkRoomStatus");
        if (status) status.textContent = "Game save unavailable in this browser. Avoid refreshing this page.";
    }
}

function clearSavedHostGame() {
    try { localStorage.removeItem(HOST_GAME_SAVE_KEY); }
    catch (error) { console.error("Could not clear the saved Acquire game.", error); }
}

function persistHostRoomSession(players = remotePlayers) {
    if (isPhoneClient || !networkRoomCode || !networkHostToken) return;
    try {
        localStorage.setItem(HOST_ROOM_SESSION_KEY, JSON.stringify({
            roomCode: networkRoomCode,
            hostToken: networkHostToken,
            players: players.map(player => ({ id: player.id, name: player.name, clientId: player.clientId || null }))
        }));
    } catch (error) { console.error("Could not save the host room session.", error); }
}

// #region Board and price table setup
// Create the 108 board spaces once. Tile ownership is reset when a new game starts.
for (let j = 0; j < gameBoardHeight; j++) {
    for (let i = 0; i < gameBoardWidth; i++) {
        gameBoard.push({
            name: i + 1 + rowLetter[j], // Combine the column number and row letter, such as "1A".
            row: j + 1, 
            column: i + 1,
            ownership: "unassigned", // Can be unassigned, board, hand, discarded, or a company name.
            holderId: null, // Identifies the player when this tile is in someone's hand.
            playability: "playable" // Recalculated when nearby companies change.
        });
    }
}

// Build the small-company reference table. Each row represents one possible company size.
// The variable j groups tile counts into the price bands used by these game rules.
for (let i = 2; i <= 41; i++) {
    let j = i;
    if(i >= 6 && i <= 10){j = 6}
    else if(i >= 11 && i <= 20){j = 7}
    else if(i >= 21 && i <= 30){j = 8}
    else if(i >= 31 && i <= 40){j = 9}
    else if(i == 41){j = 10};
    smallInformation.push({
        size: i,
        price: j * 100, // Share price is the price-band number multiplied by $100.
        majority: j * 1000, // Majority bonus is ten times the share price.
        minority : j * 500, // Second-place shareholder bonus.
        }
    );
}
// Medium companies use the same bonus pattern with their own size-to-price ranges.
// The stored size starts at i - 1 because these cards use a different starting offset.
for (let i = 3; i <= 42; i++) {
    let j = i;
    if(i >= 7 && i <= 11){j = 7}
    else if(i >= 12 && i <= 21){j = 8}
    else if(i >= 22 && i <= 31){j = 9}
    else if(i >= 32 && i <= 41){j = 10}
    else if(i == 42){j = 11};
    mediumInformation.push({
        size: i - 1,
        price: j * 100, // Current price for this company size.
        majority: j * 1000, // Majority shareholder payout for this size.
        minority : j * 500,
        }
    );
}
// Large companies have their own size-to-price ranges as well.
// Their card table uses i - 2 for the same reason the medium table uses i - 1.
for (let i = 4; i <= 43; i++) {
    let j = i;
    if(i >= 8 && i <= 12){j = 8}
    else if(i >= 13 && i <= 22){j = 9}
    else if(i >= 23 && i <= 32){j = 10}
    else if(i >= 33 && i <= 42){j = 11}
    else if(i == 43){j = 12};
    largeInformation.push({
        size: i - 2,
        price: j * 100, // Current price for this company size.
        majority: j * 1000, // Majority shareholder payout for this size.
        minority : j * 500,
        }
    );
}
// #endregion

// #region Company setup
// Company names are lowercase identifiers used in the game logic; the interface capitalizes them.
// Each record tracks its type, current board size, current price/bonuses, and unsold shares.
companies.push({
    name: "sackson",
    type: "small",
    size: 0,
    price: 0,
    majority: 0,
    minority: 0,
    sharesLeft: 25
},
{
    name: "zeta",
    type: "small",
    size: 0,
    price: 0,
    majority: 0,
    minority: 0,
    sharesLeft: 25
},
{
    name: "america",
    type: "medium",
    size: 0,
    price: 0,
    majority: 0,
    minority: 0,
    sharesLeft: 25
},
{
    name: "fusion",
    type: "medium",
    size: 0,
    price: 0,
    majority: 0,
    minority: 0,
    sharesLeft: 25
},
{
    name: "hydra",
    type: "medium",
    size: 0,
    price: 0,
    majority: 0,
    minority: 0,
    sharesLeft: 25
},
{
    name: "phoenix",
    type: "large",
    size: 0,
    price: 0,
    majority: 0,
    minority: 0,
    sharesLeft: 25
},
{
    name: "quantum",
    type: "large",
    size: 0,
    price: 0,
    majority: 0,
    minority: 0,
    sharesLeft: 25
}
);
// #endregion

// Switch from the player-count screen to the board after the Start Game button is pressed.
function startGame () {
    playerCount = Number(document.getElementById("playerSelect").value);
    document.getElementById("startScreen").style.display = "none";
    title.innerText = "Game Board";
    document.getElementById("gameBoardScreen").style.display = "block";
}
// Draw the clickable board grid and place one random starting tile for each player.
function initiateGameBoard(rows, columns, seedInitialTiles = true) {
    const container = document.getElementById("grid-container");
    container.style.gridTemplateColumns = `repeat(${columns}, 50px)`;
    container.innerHTML = "";
    for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
            const name = `${column + 1}${rowLetter[row]}`;
            const box = document.createElement("button");
            box.type = "button";
            box.classList.add("box");
            box.textContent = name;
            box.id = name;
            box.setAttribute("aria-label", `Place selected tile at ${name}`);
            // Clicking a board space asks placeTile to place the currently selected hand tile there.
            box.addEventListener("click", () => placeTile(name));
            container.appendChild(box);
        }
    }
    if (seedInitialTiles) {
        for (let i = 0; i < playerCount; i++) {
            const seedTile = unassignedTile();
            if (seedTile) updateTileOwnership(seedTile, "board");
        }
    }
}
// Pick a random tile still in the draw pool; discarded or placed tiles are excluded.
function unassignedTile() {
    const unassignedItems = gameBoard.filter(item => item.ownership === "unassigned");
    if (unassignedItems.length === 0) return null;
    return unassignedItems[Math.floor(Math.random() * unassignedItems.length)].name;
}
// Change a tile's owner and refresh its board appearance. Returns false for an unknown tile name.
function updateTileOwnership(itemName, newOwnership) {
    const item = gameBoard.find(tile => tile.name === itemName);
    if (!item) return false;
    item.ownership = newOwnership;
    item.holderId = null;
    renderBoard();
    return true;
}
// Ask for each player's name, give them starting cash, and deal six random tiles.
function initiatePlayerData() {
    playerData = [];
    for (let i = 0; i < playerCount; i++) {
        const connectedPlayer = networkEnabled ? remotePlayers[i] : null;
        if (networkEnabled && !connectedPlayer) return false;
        const enteredName = connectedPlayer ? connectedPlayer.name : prompt(`Enter player ${i + 1}'s name:`);
        if (enteredName === null) return false;
        const playerName = enteredName.trim() || `Player ${i + 1}`;
        const playerTiles = [];
        const player = {
            id: i,
            name: playerName,
            networkPlayerId: connectedPlayer?.id ?? null,
            money: 6000,
            shares: Object.fromEntries(companies.map(company => [company.name, 0])), // Each company starts with zero shares held.
            playerTiles
        };
        for (let j = 0; j < 6; j++) {
            const tile = unassignedTile();
            if (!tile) break;
            playerTiles.push(tile);
            const boardTile = gameBoard.find(item => item.name === tile);
            boardTile.ownership = "hand";
            boardTile.holderId = i;
        }
        playerData.push(player);
    }
    return true;
}
// Return the player record for the current turn.
function currentPlayer() {
    return playerData[currentPlayerIndex];
}
// At turn start, permanently discard hand tiles that would connect two safe companies,
// then draw replacements when any unassigned tiles remain.
function replaceUnplayableTilesAtTurnStart(player) {
    let replacedAny = false;
    let checkedNames = new Set(); // Avoid checking a tile again after it has been discarded.
    while (true) {
        for (const tileName of player.playerTiles) updateTilePlayability(tileName);
        const unplayableNames = player.playerTiles.filter(tileName => {
            const tile = gameBoard.find(item => item.name === tileName);
            return tile?.playability === "unplayable" && !checkedNames.has(tileName);
        });
        if (!unplayableNames.length) break;

        for (const tileName of unplayableNames) {
            checkedNames.add(tileName);
            const tile = gameBoard.find(item => item.name === tileName);
            player.playerTiles.splice(player.playerTiles.indexOf(tileName), 1);
            tile.ownership = "discarded"; // unassignedTile() only draws "unassigned" tiles.
            tile.holderId = null;

            const replacement = unassignedTile();
            if (replacement) {
                const replacementTile = gameBoard.find(item => item.name === replacement);
                replacementTile.ownership = "hand";
                replacementTile.holderId = player.id;
                player.playerTiles.push(replacement);
                replacedAny = true;
            }
        }
        if (!unassignedTile()) break;
    }
    return replacedAny;
}

// The active player may declare the end when one chain reaches 41 tiles or all are safe (11+).
function gameEndConditionMet() {
    const activeCompanies = companies.filter(company => company.size > 0);
    return activeCompanies.some(company => company.size >= 41) ||
        (activeCompanies.length > 0 && activeCompanies.every(company => company.size >= 11));
}

// Show the declaration button only when a condition is met and no merger is being resolved.
function updateEndGameButton() {
    const button = document.getElementById("endGameButton");
    if (button) button.style.display = !gameOver && !mergerState && gameEndConditionMet() ? "block" : "none";
}

// Confirm the declaration, pay final bonuses, sell shares in active companies, and show the winner.
function renderGameOverResults() {
    const highestScore = Math.max(...playerData.map(player => player.money));
    const winners = playerData.filter(player => player.money === highestScore);
    const results = document.getElementById("gameOverResults");
    results.replaceChildren();
    const winnerMessage = document.createElement("p");
    winnerMessage.textContent = winners.length > 1
        ? `The game is over. ${winners.map(player => player.name).join(" and ")} tie with $${highestScore}.`
        : `The game is over. ${winners[0].name} wins with $${highestScore}.`;
    results.appendChild(winnerMessage);
    for (const player of playerData) {
        const score = document.createElement("p");
        score.textContent = `${player.name}: $${player.money}`;
        results.appendChild(score);
    }
    if (finalSettlement.length) {
        const details = document.createElement("details");
        const summary = document.createElement("summary");
        summary.textContent = "Show final payouts";
        const payoutList = document.createElement("ul");
        for (const entry of finalSettlement) {
            const item = document.createElement("li");
            item.textContent = entry;
            payoutList.appendChild(item);
        }
        details.append(summary, payoutList);
        results.appendChild(details);
    }
}

function endGame() {
    if (gameOver || !gameEndConditionMet()) return;
    if (!confirm("Are you sure you want to end the game and calculate the final scores?")) return;

    gameOver = true;
    finalSettlement = [];
    pendingTurn = false;
    selectedTileName = null;
    mergerState = null;
    document.getElementById("stockPurchaseArea").style.display = "none";
    document.getElementById("mergerResolutionArea").style.display = "none";
    document.getElementById("endGameButton").style.display = "none";

    // Final settlements are processed from the smallest active company to the largest.
    const activeCompanies = companies.filter(company => company.size > 0).sort((a, b) => a.size - b.size);
    // Pay majority/minority bonuses before cashing in company shares.
    for (const company of activeCompanies) {
        finalSettlement.push(`${companyDisplayName(company.name)}: ${payMergerBonuses(company)}`);
    }
    // Exchange each player's shares in active companies for cash at the current share price.
    for (const company of activeCompanies) {
        for (const player of playerData) {
            const shares = player.shares[company.name] || 0;
            if (shares > 0) {
                player.money += shares * company.price;
                finalSettlement.push(`${player.name} sold ${shares} ${companyDisplayName(company.name)} share${shares === 1 ? "" : "s"} for $${shares * company.price}.`);
            }
        }
    }
    // Remove all holdings from the final display; shares in companies already absorbed are worthless.
    for (const player of playerData) {
        for (const company of companies) player.shares[company.name] = 0;
    }

    // Find the top total. More than one player can share the win if totals are tied.
    renderGameOverResults();
    document.getElementById("gameOverArea").style.display = "block";
    document.getElementById("turnStatus").textContent = "Final scores have been calculated.";
    renderBoard();
    renderHand();
    renderEconomy();
    persistHostGame();
}

// Prepare the screen for a new turn and quietly replace any tiles that became unplayable.
function takeTurn() {
    selectedTileName = null;
    pendingTurn = false;
    mergerState = null;
    document.getElementById("stockPurchaseArea").style.display = "none";
    document.getElementById("mergerResolutionArea").style.display = "none";
    const player = currentPlayer();
    if (!player) return;
    if (gameOver) return;
    replaceUnplayableTilesAtTurnStart(player);
    recalculatePlayability();
    document.getElementById("turnStatus").textContent = `${player.name}'s turn — choose one of their tiles, then click its highlighted board space.`;
    renderBoard();
    renderHand();
    renderEconomy();
    persistHostGame();
}
// Select one of the current player's tiles before they click its matching board space.
function onSelectTile(tileName) {
    const tile = gameBoard.find(item => item.name === tileName);
    const player = currentPlayer();
    if (pendingTurn || !tile || !player || tile.ownership !== "hand" || tile.holderId !== player.id) return;
    if (tile.playability === "unplayable") {
        document.getElementById("turnStatus").textContent = `${tileName} cannot be played because it would connect two safe companies.`;
        return;
    }
    selectedTileName = tileName;
    renderHand();
    renderBoard();
    document.getElementById("turnStatus").textContent = `${tileName} selected. Click the highlighted ${tileName} space to place it.`;
}
// Find the full connected area reached from a tile by walking through board tiles and companies.
// A breadth-first search ensures chains of several spaces are treated as one connected group.
function connectedTiles(startTile) {
    const found = new Set([startTile.name]);
    const queue = [startTile];
    while (queue.length) {
        for (const neighbor of getAdjacentTiles(queue.shift().name)) {
            // Hand, discarded, and empty spaces do not connect groups on the board.
            if (neighbor.ownership === "board" || companies.some(company => company.name === neighbor.ownership)) {
                if (!found.has(neighbor.name)) {
                    found.add(neighbor.name);
                    queue.push(neighbor);
                }
            }
        }
    }
    return [...found].map(name => gameBoard.find(tile => tile.name === name));
}
// Recount each company's tiles, then look up its price and bonuses for that size.
function syncCompanySizes() {
    for (const company of companies) {
        company.size = gameBoard.filter(tile => tile.ownership === company.name).length;
        // Select the correct reference table based on the company's size category.
        const table = company.type === "small" ? smallInformation : company.type === "medium" ? mediumInformation : largeInformation;
        const priceRow = table.find(row => row.size === company.size) || (company.size > 0 ? table[table.length - 1] : null);
        company.price = priceRow ? priceRow.price : 0;
        company.majority = priceRow ? priceRow.majority : 0;
        company.minority = priceRow ? priceRow.minority : 0;
    }
}
// Fill and open the shared dropdown dialog; return the selected company ID after it closes.
function chooseCompany(options, titleText) {
    if (networkEnabled && !isPhoneClient) {
        return new Promise(resolve => {
            remoteCompanyChoice = { options: options.map(company => company.name), titleText, resolve };
            updateSkipTurnButton();
            persistHostGame();
            publishNetworkSnapshot();
        });
    }
    const dialog = document.getElementById("companyChoiceDialog");
    const select = document.getElementById("companyChoiceSelect");
    document.getElementById("companyChoiceTitle").textContent = titleText;
    select.innerHTML = "";
    for (const company of options) {
        const option = document.createElement("option");
        option.value = company.name;
        option.textContent = companyDisplayName(company.name);
        select.appendChild(option);
    }
    dialog.returnValue = "";
    return new Promise(resolve => {
        // The dialog's Choose button returns the selected value; Cancel/Escape returns null.
        dialog.addEventListener("close", () => {
            resolve(dialog.returnValue === "choose" ? select.value : null);
        }, { once: true });
        dialog.showModal();
        select.focus();
    });
}

// Turn a newly connected group of unincorporated tiles into a company chosen from the dropdown.
async function foundCompany(component) {
    const available = companies.filter(company => company.size === 0);
    if (!available.length) return null;
    const selectedName = await chooseCompany(available, "Choose a company to start");
    const company = available.find(item => item.name === selectedName) || available[0];
    for (const tile of component) tile.ownership = company.name;
    const founder = currentPlayer();
    if (founder && company.sharesLeft > 0) {
        founder.shares[company.name] += 1;
        company.sharesLeft -= 1;
    }
    return company;
}
// Bonuses split between tied shareholders are rounded up to the next $100.
function roundUpToHundred(amount) {
    return Math.ceil(amount / 100) * 100;
}
// Pay a company's majority and minority bonuses using the shareholders' current share counts.
function payMergerBonuses(company) {
    const holders = playerData
        .map(player => ({ player, shares: player.shares[company.name] || 0 }))
        .filter(holder => holder.shares > 0)
        .sort((a, b) => b.shares - a.shares);
    if (!holders.length) return "No shareholder bonuses were due.";

    const topShares = holders[0].shares; // Holders are sorted from most shares to fewest.
    const primaryHolders = holders.filter(holder => holder.shares === topShares);
    // A tie for first place divides both bonuses among the tied top holders.
    if (primaryHolders.length > 1) {
        const payout = roundUpToHundred((company.majority + company.minority) / primaryHolders.length);
        primaryHolders.forEach(holder => { holder.player.money += payout; });
        return `Tied for majority: each of ${primaryHolders.map(holder => holder.player.name).join(", ")} received $${payout}.`;
    }

    const primary = primaryHolders[0];
    const secondPlace = holders.filter(holder => holder.player.id !== primary.player.id);
    // If nobody else owns shares, the only shareholder gets both bonuses.
    if (!secondPlace.length) {
        const payout = company.majority + company.minority;
        primary.player.money += payout;
        return `${primary.player.name} was the only shareholder and received both bonuses ($${payout}).`;
    }

    primary.player.money += company.majority;
    const secondShares = secondPlace[0].shares;
    const secondaryHolders = secondPlace.filter(holder => holder.shares === secondShares);
    const secondaryPayout = roundUpToHundred(company.minority / secondaryHolders.length);
    secondaryHolders.forEach(holder => { holder.player.money += secondaryPayout; });
    return `${primary.player.name} received the majority bonus ($${company.majority}); ${secondaryHolders.map(holder => holder.player.name).join(", ")} received $${secondaryPayout} each for the minority bonus.`;
}
// Save the tile group and involved companies, then begin resolving the merger one company at a time.
function startMerger(component, companyNames) {
    mergerState = {
        stage: "selecting-survivor",
        componentTileNames: component.map(tile => tile.name), // These spaces become part of the final surviving company.
        remainingCompanyNames: [...companyNames],
        mergerPlayerIndex: currentPlayerIndex, // Merger share decisions start with the player who caused it.
        survivorName: null,
        loserSnapshot: null,
        playerOrder: [],
        playerStep: 0
    };
    pendingTurn = true;
    selectedTileName = null;
    document.getElementById("stockPurchaseArea").style.display = "none";
    renderBoard();
    renderHand();
    persistHostGame();
    startNextMerger();
}
// Select the survivor and largest loser for the next step of a multi-company merger.
async function startNextMerger() {
    mergerState.stage = "selecting-survivor";
    const active = mergerState.remainingCompanyNames
        .map(name => companies.find(company => company.name === name))
        .filter(company => company && company.size > 0);
    if (active.length <= 1) {
        finishMergerSequence(active[0]);
        return;
    }

    // A safe company must survive. Otherwise the largest company survives; ties use the dropdown.
    const safeCompanies = active.filter(company => company.size >= 11);
    const largestSize = Math.max(...active.map(company => company.size));
    const largestCompanies = active.filter(company => company.size === largestSize);
    let survivor = safeCompanies[0] || largestCompanies[0];
    if (!safeCompanies.length && largestCompanies.length > 1) {
        const selectedName = await chooseCompany(largestCompanies, "Choose which company survives the tie");
        survivor = largestCompanies.find(company => company.name === selectedName) || largestCompanies[0];
    }
    // If several companies lose, handle the largest losing company first.
    const possibleLosers = active.filter(company => company.name !== survivor.name);
    possibleLosers.sort((a, b) => b.size - a.size);
    const loser = possibleLosers[0];
    mergerState.survivorName = survivor.name;
    // Store the loser's current price and bonuses before its size becomes zero.
    mergerState.loserSnapshot = {
        name: loser.name,
        size: loser.size,
        price: loser.price,
        majority: loser.majority,
        minority: loser.minority
    };
    mergerState.stage = "resolving";
    // Visit players in turn order, starting with the player who played the merger tile.
    mergerState.playerOrder = playerData.map((player, offset) => playerData[(mergerState.mergerPlayerIndex + offset) % playerData.length]);
    mergerState.playerStep = 0;
    const bonusResult = payMergerBonuses(mergerState.loserSnapshot);
    mergerState.bonusSummary = bonusResult;
    document.getElementById("mergerTitle").textContent = `${companyDisplayName(loser.name)} is absorbed by ${companyDisplayName(survivor.name)}`;
    document.getElementById("mergerBonusSummary").textContent = `${companyDisplayName(loser.name)} had ${loser.size} tiles. Its share price was $${loser.price}. Bonuses: majority $${loser.majority}, minority $${loser.minority}. ${bonusResult}`;
    document.getElementById("mergerResolutionArea").style.display = "block";
    document.getElementById("turnStatus").textContent = `Merger in progress: resolve ${companyDisplayName(loser.name)}'s shares before continuing.`;
    renderBoard();
    renderEconomy();
    persistHostGame();
    await showNextMergerPlayer();
}
// Find the next player with shares in the losing company and prepare their sell/trade controls.
async function showNextMergerPlayer() {
    const loserName = mergerState.loserSnapshot.name;
    while (mergerState.playerStep < mergerState.playerOrder.length) {
        const player = mergerState.playerOrder[mergerState.playerStep];
        const sharesHeld = player.shares[loserName] || 0;
        if (sharesHeld > 0) {
            const survivor = companies.find(company => company.name === mergerState.survivorName);
            // Two losing shares trade for one survivor share; available shares also limit the trade.
            const maxTrades = Math.min(Math.floor(sharesHeld / 2), survivor.sharesLeft);
            document.getElementById("mergerPlayerPrompt").textContent = `${player.name} has ${sharesHeld} ${companyDisplayName(loserName)} share${sharesHeld === 1 ? "" : "s"}. Sell any number, trade pairs for ${companyDisplayName(survivor.name)} shares (up to ${maxTrades}), or keep the rest.`;
            const sellInput = document.getElementById("mergerSellInput");
            const tradeInput = document.getElementById("mergerTradeInput");
            sellInput.value = "0";
            sellInput.max = String(sharesHeld);
            tradeInput.value = "0";
            tradeInput.max = String(maxTrades);
            sellInput.oninput = updateMergerHoldSummary;
            tradeInput.oninput = updateMergerHoldSummary;
            updateMergerHoldSummary();
            document.getElementById("resolveMergerPlayerButton").disabled = false;
            publishNetworkSnapshot();
            return;
        }
        mergerState.playerStep += 1;
    }
    await completeCurrentMerger();
}
// Preview how many losing-company shares remain after the entered sales and trades.
function updateMergerHoldSummary() {
    if (!mergerState) return;
    const player = mergerState.playerOrder[mergerState.playerStep];
    if (!player) return;
    const held = player.shares[mergerState.loserSnapshot.name] || 0;
    const sold = Number(document.getElementById("mergerSellInput").value) || 0;
    const traded = Number(document.getElementById("mergerTradeInput").value) || 0;
    const remaining = held - sold - traded * 2; // Each trade consumes two old shares.
    if (remaining < 0) {
        document.getElementById("mergerHoldSummary").textContent = "Sell and trade fewer shares than you hold.";
        return;
    }
    document.getElementById("mergerHoldSummary").textContent = `You will keep ${remaining} ${companyDisplayName(mergerState.loserSnapshot.name)} share${remaining === 1 ? "" : "s"}. Selling ${sold} pays $${sold * mergerState.loserSnapshot.price}; trading uses ${traded * 2} old shares.`;
}
// Validate and apply one shareholder's merger choices, then move to the next shareholder.
async function resolveMergerPlayer() {
    if (!mergerState) return;
    const player = mergerState.playerOrder[mergerState.playerStep];
    const loser = companies.find(company => company.name === mergerState.loserSnapshot.name);
    const survivor = companies.find(company => company.name === mergerState.survivorName);
    const held = player.shares[loser.name] || 0;
    const sold = Number(document.getElementById("mergerSellInput").value);
    const traded = Number(document.getElementById("mergerTradeInput").value);
    // Reject fractions, negative numbers, selling/trading more than held, or exceeding survivor stock.
    if (!Number.isInteger(sold) || !Number.isInteger(traded) || sold < 0 || traded < 0 || sold + traded * 2 > held || traded > survivor.sharesLeft) {
        document.getElementById("mergerHoldSummary").textContent = "Choose whole numbers that fit your share count and the surviving company's available shares.";
        return;
    }
    player.money += sold * mergerState.loserSnapshot.price;
    player.shares[loser.name] -= sold + traded * 2;
    player.shares[survivor.name] += traded;
    loser.sharesLeft += sold + traded * 2;
    survivor.sharesLeft -= traded;
    mergerState.playerStep += 1;
    renderEconomy();
    persistHostGame();
    await showNextMergerPlayer();
}
// Move the losing company's board tiles to the survivor, then process any remaining losing companies.
async function completeCurrentMerger() {
    mergerState.stage = "next-company";
    const loserName = mergerState.loserSnapshot.name;
    const survivorName = mergerState.survivorName;
    for (const tile of gameBoard) {
        if (tile.ownership === loserName) tile.ownership = survivorName;
    }
    mergerState.remainingCompanyNames = mergerState.remainingCompanyNames.filter(name => name !== loserName);
    syncCompanySizes();
    renderBoard();
    renderEconomy();
    persistHostGame();
    document.getElementById("mergerResolutionArea").style.display = "none";
    await startNextMerger();
}
// Attach the tile that caused the merger to the final survivor, refresh the board, and resume the turn.
function finishMergerSequence(survivor) {
    if (!survivor) {
        mergerState = null;
        pendingTurn = false;
        showStockPurchase();
        return;
    }
    for (const tileName of mergerState.componentTileNames) {
        const tile = gameBoard.find(item => item.name === tileName);
        if (tile) tile.ownership = survivor.name;
    }
    const survivorName = survivor.name;
    mergerState = null;
    syncCompanySizes();
    recalculatePlayability();
    document.getElementById("mergerResolutionArea").style.display = "none";
    document.getElementById("turnStatus").textContent = `The merger is complete. ${companyDisplayName(survivorName)} survived. Buy up to 3 shares, then finish your turn.`;
    renderBoard();
    renderHand();
    renderEconomy();
    showStockPurchase();
}
// Companies are purchasable only if active, priced, and still have shares available.
function availableStockCompanies() {
    return companies.filter(company => company.size > 0 && company.sharesLeft > 0 && company.price > 0);
}
// Used to skip the purchase screen when the player cannot afford any available share.
function cheapestAvailableStockPrice() {
    const available = availableStockCompanies();
    return available.length ? Math.min(...available.map(company => company.price)) : null;
}
// Place the selected tile and decide whether it starts, grows, or merges companies.
async function placeTile(tileName) {
    const target = gameBoard.find(item => item.name === tileName);
    const player = currentPlayer();
    if (!target || !player || !selectedTileName || tileName !== selectedTileName) return;
    if (target.ownership !== "hand" || target.holderId !== player.id) return;
    if (target.playability === "unplayable") {
        document.getElementById("turnStatus").textContent = `${tileName} is not a legal space: it would connect two safe companies.`;
        return;
    }
    const handTile = target;
    const handIndex = player.playerTiles.indexOf(selectedTileName);
    if (handIndex < 0) return;

    handTile.ownership = "board";
    handTile.holderId = null;
    player.playerTiles.splice(handIndex, 1);
    // Inspect all board spaces connected to this placement to determine its effect.
    const component = connectedTiles(target);
    const touchingCompanies = [...new Set(component.map(tile => tile.ownership).filter(owner => companies.some(company => company.name === owner)))];
    let resultText = `${tileName} was placed.`;

    // A connected unincorporated group starts a company; a group with one company grows it.
    if (touchingCompanies.length === 0) {
        if (component.length > 1) {
            const newCompany = await foundCompany(component);
            resultText += newCompany ? ` ${companyDisplayName(newCompany.name)} was started.` : " No company was available, so the tiles remain unincorporated.";
        }
    } else if (touchingCompanies.length === 1) {
        for (const tile of component) tile.ownership = touchingCompanies[0];
        resultText += ` It joined ${companyDisplayName(touchingCompanies[0])}.`;
    } else {
        // Multiple companies trigger a merger unless the move would join two safe companies.
        const active = touchingCompanies.map(name => companies.find(company => company.name === name));
        const safe = active.filter(company => company.size >= 11);
        if (safe.length >= 2) {
            // This safety check should usually catch the tile before placement; restore it defensively.
            target.ownership = "unassigned";
            handTile.ownership = "hand";
            handTile.holderId = player.id;
            handTile.playability = "unplayable";
            player.playerTiles.splice(handIndex, 0, selectedTileName);
            resultText = `${tileName} was returned to your hand because it would connect two safe companies.`;
        } else {
            startMerger(component, touchingCompanies);
            return;
        }
    }

    syncCompanySizes();
    selectedTileName = null;
    // Successful placements end up owned by a company or as an unincorporated board tile.
    const placementSucceeded = handTile.ownership !== "hand";
    recalculatePlayability();
    document.getElementById("turnStatus").textContent = placementSucceeded
        ? `${resultText} Buy up to 3 shares, then finish your turn.`
        : `${resultText} Choose a different tile.`;
    renderBoard();
    renderHand();
    renderEconomy();
    if (placementSucceeded) showStockPurchase();
    else persistHostGame();
}
// Return the up/down/left/right neighbors of a named board space (diagonals do not connect).
function getAdjacentTiles(tile) {
    const item  = gameBoard.find(item => item.name === tile); // Find the item in the gameBoard array
    if (!item) return [];
    const row = item.row; // Get the row of the tile
    const column = item.column; // Get the column of the tile
    const adjacentTiles = []; // Create an array to hold the adjacent tiles
    const directions = [ // Only edge-sharing spaces count as neighbors in Acquire.
        { row: -1, column: 0 }, // Up
        { row: 1, column: 0 }, // Down
        { row: 0, column: -1 }, // Left
        { row: 0, column: 1 } // Right
    ];
    for (const direction of directions) { // Loop through each direction
        const newRow = row + direction.row; // Calculate the new row
        const newColumn = column + direction.column; // Calculate the new column
        if (newRow >= 1 && newRow <= gameBoardHeight && newColumn >= 1 && newColumn <= gameBoardWidth) { // Check if the new row and column are within bounds
            const adjacentTile = gameBoard.find(item => item.row === newRow && item.column === newColumn); // Find the adjacent tile in the gameBoard array
            if (adjacentTile) { // If the adjacent tile exists, add it to the array
                adjacentTiles.push(adjacentTile);
            }
        }
    }
    return adjacentTiles; // Return the array of adjacent tiles 
} 
// Mark a tile unplayable when placing it would connect two or more safe companies.
function updateTilePlayability(tile) {
    const item = gameBoard.find(boardTile => boardTile.name === tile);
    if (!item) return false;
    // Set removes duplicate company names when several of their tiles touch the same area.
    const connectedCompanies = [...new Set(connectedTiles(item)
        .map(connectedTile => companies.find(company => company.name === connectedTile.ownership))
        .filter(Boolean))];
    const safeCompanies = connectedCompanies.filter(company => company.size >= 11);
    item.playability = safeCompanies.length >= 2 ? "unplayable" : "playable";
    return item.playability;
}

// Used for hand previews: true when the tile would join unincorporated spaces but no company.
function wouldStartCompany(tileName) {
    const tile = gameBoard.find(item => item.name === tileName);
    if (!tile) return false;
    const connected = connectedTiles(tile);
    const touchesUnincorporatedTile = connected.some(tile => tile.ownership === "board");
    const touchesCompany = connected.some(tile => companies.some(company => company.name === tile.ownership));
    return touchesUnincorporatedTile && !touchesCompany;
}

// Return the distinct companies that a tile would connect to if it were placed.
function companiesTileWouldTouch(tileName) {
    const tile = gameBoard.find(item => item.name === tileName);
    if (!tile) return [];
    return [...new Set(connectedTiles(tile)
        .map(connectedTile => connectedTile.ownership)
        .filter(owner => companies.some(company => company.name === owner)))];
}

// Refresh legality for tiles in hands and the draw pool after board/company changes.
function recalculatePlayability() {
    for (const tile of gameBoard) {
        if (tile.ownership === "unassigned" || tile.ownership === "hand") updateTilePlayability(tile.name);
    }
}

// Copy the current board data into the HTML buttons, including color and click availability.
function renderBoard() {
    for (const tile of gameBoard) {
        const element = document.getElementById(tile.name);
        if (!element) continue;
        const company = companies.find(item => item.name === tile.ownership);
        // Company spaces use company colors, unincorporated spaces use gray, and empty spaces are white.
        element.style.backgroundColor = company ? companyColors[company.name] : tile.ownership === "board" ? "#999" : "white";
        element.classList.toggle("selected", tile.name === selectedTileName);
        element.disabled = gameOver || !selectedTileName || tile.name !== selectedTileName || tile.ownership !== "hand";
        element.title = tile.playability === "unplayable" ? "Cannot be played: connects two safe companies" : tile.ownership;
    }
}

// Rebuild the current player's hand and color each tile to preview the result of placing it.
function renderHand() {
    const hand = document.getElementById("playerHand");
    if (!hand) return;
    hand.innerHTML = "";
    const player = currentPlayer();
    if (!player) return;
    for (const tileName of player.playerTiles) {
        const tile = gameBoard.find(item => item.name === tileName);
        const button = document.createElement("button");
        button.type = "button";
        button.className = "hand-tile";
        button.textContent = tileName;
        button.disabled = gameOver || pendingTurn || tile?.playability === "unplayable";
        const touchedCompanyNames = companiesTileWouldTouch(tileName);
        // One company means growth; multiple colors mean a merger; gray means a new company.
        if (touchedCompanyNames.length === 1) {
            button.style.backgroundColor = companyColors[touchedCompanyNames[0]];
            button.title = `Playing this tile would add to ${companyDisplayName(touchedCompanyNames[0])}`;
        } else if (touchedCompanyNames.length > 1) {
            const slice = 100 / touchedCompanyNames.length; // Divide the circle evenly among merging companies.
            const colorStops = touchedCompanyNames.map((name, index) => {
                const start = index * slice;
                const end = (index + 1) * slice;
                return `${companyColors[name]} ${start}% ${end}%`;
            });
            button.style.backgroundImage = `conic-gradient(${colorStops.join(", ")})`;
            button.title = `Playing this tile would merge ${touchedCompanyNames.map(companyDisplayName).join(" and ")}`;
        } else if (tile && tile.playability !== "unplayable" && wouldStartCompany(tileName)) {
            button.classList.add("starts-company");
            button.title = "Playing this tile would start a company";
        }
        button.classList.toggle("selected", tileName === selectedTileName);
        button.addEventListener("click", () => onSelectTile(tileName));
        hand.appendChild(button);
    }
}

// Refresh player balances/share holdings, active company details, and the game-end button.
function renderEconomy() {
    const playersElement = document.getElementById("playerSummary");
    const companiesElement = document.getElementById("companySummary");
    if (!playersElement || !companiesElement) return;
    playersElement.innerHTML = "";
    for (const player of playerData) {
        const card = document.createElement("div");
        card.className = "summary-card";
        const holdings = Object.entries(player.shares).filter(([, count]) => count > 0).map(([name, count]) => `${companyDisplayName(name)}: ${count}`).join(", ") || "none";
        card.textContent = `${player.name}${player.id === currentPlayerIndex ? " (current)" : ""} — $${player.money} — shares: ${holdings}`;
        playersElement.appendChild(card);
    }
    companiesElement.innerHTML = "";
    const activeCompanies = companies.filter(company => company.size > 0);
    if (!activeCompanies.length) companiesElement.textContent = "No companies have been started.";
    for (const company of activeCompanies) {
        const card = document.createElement("div");
        card.className = "summary-card";
        const marker = document.createElement("span");
        marker.className = "company-color-dot";
        marker.style.backgroundColor = companyColors[company.name];
        marker.setAttribute("aria-hidden", "true");
        const details = document.createElement("span");
        details.textContent = `${companyDisplayName(company.name)} — ${company.size} tiles — $${company.price}/share — ${company.sharesLeft} shares left`;
        card.append(marker, details);
        companiesElement.appendChild(card);
    }
    updateEndGameButton();
    updateSkipTurnButton();
    publishNetworkSnapshot();
}

// Keep the host override available only when advancing cannot interrupt a rule decision.
function updateSkipTurnButton() {
    const button = document.getElementById("skipTurnButton");
    if (button) button.disabled = !networkEnabled || !playerData.length || gameOver || Boolean(mergerState || remoteCompanyChoice);
    const newGameButton = document.getElementById("newGameButton");
    if (newGameButton) newGameButton.disabled = Boolean(mergerState || remoteCompanyChoice);
}

// Publish a read-only mirror of the existing game state for connected phones.
// All rule checks and state changes still happen in this original browser game.
function makeNetworkSnapshot() {
    const players = playerData.map(player => ({
        id: player.id,
        name: player.name,
        money: player.money,
        shares: { ...player.shares },
        hand: player.playerTiles.map(tileName => {
            const tile = gameBoard.find(item => item.name === tileName);
            const touched = companiesTileWouldTouch(tileName);
            let background = "#fff";
            let titleText = `Playing ${tileName}`;
            if (touched.length === 1) {
                background = companyColors[touched[0]];
                titleText = `Playing this tile would add to ${companyDisplayName(touched[0])}`;
            } else if (touched.length > 1) {
                const slice = 100 / touched.length;
                background = `conic-gradient(${touched.map((name, index) => `${companyColors[name]} ${index * slice}% ${(index + 1) * slice}%`).join(", ")})`;
                titleText = `Playing this tile would merge ${touched.map(companyDisplayName).join(" and ")}`;
            } else if (tile && tile.playability !== "unplayable" && wouldStartCompany(tileName)) {
                background = "#999";
                titleText = "Playing this tile would start a company";
            }
            return { name: tileName, background, title: titleText, unplayable: tile?.playability === "unplayable" };
        })
    }));
    let pending = null;
    if (remoteCompanyChoice) {
        pending = { type: "choice", playerId: currentPlayerIndex, title: remoteCompanyChoice.titleText, choices: remoteCompanyChoice.options };
    } else if (mergerState) {
        const player = mergerState.playerOrder?.[mergerState.playerStep];
        const survivor = companies.find(company => company.name === mergerState.survivorName);
        pending = player ? {
            type: "merger", playerId: player.id, playerName: player.name,
            loser: mergerState.loserSnapshot.name, survivor: mergerState.survivorName,
            shares: player.shares[mergerState.loserSnapshot.name] || 0,
            maxTrades: Math.min(Math.floor((player.shares[mergerState.loserSnapshot.name] || 0) / 2), survivor?.sharesLeft || 0),
            price: mergerState.loserSnapshot.price
        } : { type: "busy" };
    } else if (pendingTurn) {
        pending = { type: "buy", playerId: currentPlayerIndex };
    }
    return {
        phase: gameOver ? "finished" : playerData.length ? "playing" : "lobby",
        board: gameBoard.filter(tile => tile.ownership === "board" || companies.some(company => company.name === tile.ownership)).map(tile => ({ name: tile.name, owner: tile.ownership })),
        players,
        companies: companies.map(company => ({ name: company.name, size: company.size, price: company.price, sharesLeft: company.sharesLeft, color: companyColors[company.name] })),
        currentPlayerId: currentPlayerIndex,
        pending,
        winners: gameOver ? playerData.filter(player => player.money === Math.max(...playerData.map(item => item.money))).map(player => player.name) : []
    };
}

function publishNetworkSnapshot() {
    if (!networkEnabled || isPhoneClient || !networkRoomCode) return;
    clearTimeout(networkPublishTimer);
    networkPublishTimer = setTimeout(() => {
        fetch("/api/snapshot", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ room: networkRoomCode, hostToken: networkHostToken, revision: ++networkSnapshotRevision, snapshot: makeNetworkSnapshot() })
        }).catch(() => {});
    }, 30);
}

function resolveRemoteCompany(name) {
    if (!remoteCompanyChoice || !remoteCompanyChoice.options.includes(name)) return;
    const pending = remoteCompanyChoice;
    remoteCompanyChoice = null;
    updateSkipTurnButton();
    pending.resolve(name);
}

async function handleRemoteAction(action) {
    if (action.type === "play") {
        if (action.playerId !== currentPlayerIndex || pendingTurn || mergerState || remoteCompanyChoice) return;
        onSelectTile(action.tile);
        // placeTile may wait for a company choice from this same phone, so do not
        // hold the event handler open while that pending choice is displayed.
        placeTile(action.tile).catch(error => console.error("Remote tile action failed", error));
        return;
    }
    if (action.type === "choice") {
        resolveRemoteCompany(action.company);
        return;
    }
    if (action.type === "buy") {
        if (!pendingTurn || mergerState || action.playerId !== currentPlayerIndex) return;
        for (const input of document.querySelectorAll("#stockPurchaseOptions input")) {
            input.value = String(action.purchases?.find(item => item.company === input.dataset.company)?.quantity ?? 0);
        }
        finishTurn();
        return;
    }
    if (action.type === "merger") {
        const player = mergerState?.playerOrder?.[mergerState.playerStep];
        if (!player || player.id !== action.playerId) return;
        document.getElementById("mergerSellInput").value = String(action.sell || 0);
        document.getElementById("mergerTradeInput").value = String(action.trade || 0);
        await resolveMergerPlayer();
    }
}

function updateHostRoomPanel(room) {
    remotePlayers = room.players || [];
    persistHostRoomSession(remotePlayers);
    const status = document.getElementById("networkRoomStatus");
    const players = document.getElementById("networkPlayers");
    const roomCodeDisplay = document.getElementById("networkRoomCodeDisplay");
    if (roomCodeDisplay) roomCodeDisplay.textContent = networkRoomCode || "----";
    if (status) status.textContent = "Share a link for a network connection below.";
    if (players) {
        const count = Number(document.getElementById("playerSelect")?.value || 2);
        const online = remotePlayers.filter(player => player.connected).length;
        const lobby = !playerData.length && !gameOver;
        document.body.classList.toggle("network-game-active", Boolean(playerData.length));
        players.hidden = !lobby;
        if (lobby) {
            const signature = remotePlayers.map(player => `${player.id}:${player.name}`).join("|");
            if (signature !== lobbyRosterSignature) {
                players.replaceChildren();
                lobbyPlayerTiles = new Map();
                const summary = document.createElement("p");
                summary.className = "lobby-player-count";
                players.appendChild(summary);
                if (!remotePlayers.length) {
                    const emptyState = document.createElement("div");
                    emptyState.className = "lobby-empty-state";
                    const title = document.createElement("strong");
                    title.textContent = "Waiting for players";
                    const instructions = document.createElement("span");
                    instructions.textContent = "Players can enter the room code or open a join link to take a seat.";
                    emptyState.append(title, instructions);
                    players.appendChild(emptyState);
                }
                const grid = document.createElement("div");
                grid.className = "lobby-player-grid";
                for (const player of remotePlayers) {
                    const tile = document.createElement("div");
                    tile.className = "lobby-player-tile";
                    const info = document.createElement("div");
                    info.className = "lobby-player-info";
                    const name = document.createElement("span");
                    name.className = "lobby-player-name";
                    name.textContent = player.name;
                    const connection = document.createElement("span");
                    connection.className = "lobby-player-status";
                    connection.textContent = player.connected ? "Connected" : "Disconnected";
                    info.append(name, connection);
                    const kick = document.createElement("button");
                    kick.type = "button";
                    kick.className = "lobby-kick-button";
                    kick.textContent = "Kick";
                    kick.setAttribute("aria-label", `Remove ${player.name} from the lobby`);
                    kick.onclick = () => {
                        const currentPlayer = remotePlayers.find(item => item.id === player.id);
                        if (currentPlayer) kickLobbyPlayer(currentPlayer, kick);
                    };
                    tile.append(info, kick);
                    grid.appendChild(tile);
                    lobbyPlayerTiles.set(player.id, { tile, name, connection });
                }
                players.appendChild(grid);
                lobbyRosterSignature = signature;
            }
            const summary = players.querySelector(".lobby-player-count");
            if (summary) summary.textContent = `${online} of ${count} selected players connected`;
            for (const player of remotePlayers) {
                const tile = lobbyPlayerTiles.get(player.id);
                if (tile) {
                    tile.name.textContent = player.name;
                    tile.connection.textContent = player.connected ? "Connected" : "Disconnected";
                    tile.tile.classList.toggle("is-connected", player.connected);
                    tile.tile.classList.toggle("is-disconnected", !player.connected);
                }
            }
        } else {
            players.replaceChildren();
            lobbyPlayerTiles = new Map();
            lobbyRosterSignature = null;
        }
        const startButton = document.getElementById("startGameButton");
        if (startButton) startButton.disabled = remotePlayers.length !== count || online !== count;
    }
}

async function kickLobbyPlayer(player, button) {
    if (playerData.length || gameOver || button.disabled) return;
    const actionStatus = document.getElementById("networkActionStatus");
    button.disabled = true;
    button.textContent = "Removing…";
    if (actionStatus) actionStatus.textContent = `Removing ${player.name} from the lobby…`;
    try {
        const result = await phoneRequest("/api/kick", {
            room: networkRoomCode,
            hostToken: networkHostToken,
            playerId: player.id,
            hostPhase: !playerData.length && !gameOver ? "lobby" : "playing"
        });
        updateHostRoomPanel({ players: result.players });
        if (actionStatus) actionStatus.textContent = `${player.name} was removed. They can rejoin with a different name.`;
    } catch (error) {
        if (actionStatus) actionStatus.textContent = `Could not remove ${player.name}: ${error.message}`;
        button.textContent = "Kick";
        button.disabled = false;
    }
}

async function startHostNetwork() {
    document.body.classList.add("network-host");
    const panel = document.getElementById("networkRoomPanel");
    panel.style.display = "block";
    const startButton = document.getElementById("startGameButton");
    startButton.disabled = true;
    try {
        const healthResponse = await fetch("/api/health");
        const health = await healthResponse.json();
        if (!healthResponse.ok || health.features?.lobbyKick !== 2) {
            throw new Error("Restart the Node server to enable lobby player removal.");
        }
        const savedRoom = readHostRoomSession();
        const savedGame = readSavedHostGame();
        const savedPlayers = savedRoom?.players?.length
            ? savedRoom.players
            : (savedGame?.playerData || []).map(player => ({ id: player.id, name: player.name }));
        const response = await fetch("/api/host-room", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ...(savedRoom || {}), players: savedPlayers })
        });
        const room = await response.json();
        if (!response.ok) throw new Error(room.error || "Could not start the phone room.");
        if (savedRoom?.roomCode && room.code !== savedRoom.roomCode) {
            throw new Error(`The saved room ${savedRoom.roomCode} could not be resumed. The server offered ${room.code}, so the saved room was kept unchanged. Restart the Node server and refresh this page to retry.`);
        }
        networkRoomCode = room.code;
        networkHostToken = room.hostToken;
        networkSnapshotRevision = Number(room.snapshotRevision) || 0;
        remotePlayers = room.players || [];
        networkEnabled = true;
        persistHostRoomSession(remotePlayers.length ? remotePlayers : savedRoom?.players || []);
        if (savedGame && !restoreSavedHostGame(savedGame)) {
            document.getElementById("networkRoomStatus").textContent = "A saved game was found but could not be restored. It remains saved; use New Game only if you want to discard it.";
        }
        const status = document.getElementById("networkRoomStatus");
        const roomCodeDisplay = document.getElementById("networkRoomCodeDisplay");
        if (roomCodeDisplay) roomCodeDisplay.textContent = room.code;
        const restoreWarning = savedGame && !playerData.length;
        if (!restoreWarning) status.textContent = "Share a link for a network connection below.";
        const links = document.getElementById("networkJoinLinks");
        links.replaceChildren();
        for (const address of room.addresses) {
            const link = document.createElement("a");
            link.href = `http://${address.address}:${room.port}/?join=${room.code}`;
            link.className = "lobby-network-link";
            const interfaceName = String(address.name || "");
            const networkType = /wi.?fi|wireless|wlan/i.test(interfaceName)
                ? "Wi-Fi"
                : /ethernet|local area connection|\blan\b/i.test(interfaceName)
                    ? "Ethernet"
                    : interfaceName || "Network";
            const label = document.createElement("span");
            label.className = "lobby-network-label";
            label.textContent = networkType;
            const destination = document.createElement("span");
            destination.className = "lobby-network-url";
            destination.textContent = link.href;
            link.append(label, destination);
            link.setAttribute("aria-label", `${networkType} reconnect link: ${link.href}`);
            link.title = `Open this complete phone join link for room ${room.code}`;
            // Keep the laptop host page alive when testing a client on this computer.
            link.target = "_blank";
            link.rel = "noopener";
            links.appendChild(link);
        }
        if (!room.addresses.length) {
            const link = document.createElement("a");
            link.href = `${window.location.origin}/?join=${room.code}`;
            link.className = "lobby-network-link";
            const label = document.createElement("span");
            label.className = "lobby-network-label";
            label.textContent = "Current connection";
            const destination = document.createElement("span");
            destination.className = "lobby-network-url";
            destination.textContent = link.href;
            link.append(label, destination);
            links.appendChild(link);
            status.textContent = `No Wi-Fi address was detected. Use the room code ${room.code} and the laptop's Wi-Fi address.`;
        }
        hostEventSource = new EventSource(`/api/events?room=${encodeURIComponent(networkRoomCode)}&host=${encodeURIComponent(networkHostToken)}`);
        hostEventSource.addEventListener("roster", event => {
            updateHostRoomPanel(JSON.parse(event.data));
        });
        hostEventSource.addEventListener("action", event => {
            const action = JSON.parse(event.data);
            handleRemoteAction(action).catch(error => console.error("Remote action failed", error));
        });
    } catch (error) {
        document.getElementById("networkRoomStatus").textContent = `Phone connection unavailable: ${error.message}`;
    }
}

function restoreSavedHostGame(saved) {
    if (!saved || saved.gameBoard.length !== gameBoard.length || !saved.playerData.length || !Array.isArray(saved.companies)) return false;
    const restoredPlayerCount = Number(saved.playerCount) || saved.playerData.length;
    if (restoredPlayerCount < 2 || restoredPlayerCount > 6 || saved.currentPlayerIndex < 0 || saved.currentPlayerIndex >= saved.playerData.length) return false;
    const savedCompanies = new Map(saved.companies.map(company => [company.name, company]));
    if (companies.some(company => !savedCompanies.has(company.name))) return false;

    playerCount = restoredPlayerCount;
    document.getElementById("playerSelect").value = String(playerCount);
    gameBoard = saved.gameBoard.map(tile => ({ ...tile }));
    playerData = saved.playerData.map(player => ({ ...player, playerTiles: [...player.playerTiles], shares: { ...player.shares } }));
    companies.forEach(company => Object.assign(company, savedCompanies.get(company.name)));
    currentPlayerIndex = Number(saved.currentPlayerIndex);
    pendingTurn = Boolean(saved.pendingTurn);
    gameOver = Boolean(saved.gameOver);
    finalSettlement = Array.isArray(saved.finalSettlement) ? [...saved.finalSettlement] : [];
    selectedTileName = null;
    const savedMerger = saved.mergerState;
    mergerState = savedMerger ? {
        ...savedMerger,
        playerOrder: (savedMerger.playerOrderIds || []).map(id => playerData.find(player => player.id === id)).filter(Boolean)
    } : null;
    remoteCompanyChoice = null;

    document.getElementById("startScreen").style.display = "none";
    document.getElementById("gameBoardScreen").style.display = "block";
    document.getElementById("gameOverArea").style.display = gameOver ? "block" : "none";
    document.getElementById("mergerResolutionArea").style.display = "none";
    document.getElementById("stockPurchaseArea").style.display = "none";
    title.textContent = "Game Board";
    initiateGameBoard(gameBoardHeight, gameBoardWidth, false);
    recalculatePlayability();
    renderBoard();
    renderHand();
    renderEconomy();

    if (gameOver) {
        document.getElementById("turnStatus").textContent = "Final scores have been restored.";
        renderGameOverResults();
    } else if (mergerState) {
        if (mergerState.stage === "resolving" && mergerState.loserSnapshot) {
            document.getElementById("mergerTitle").textContent = `${companyDisplayName(mergerState.loserSnapshot.name)} is absorbed by ${companyDisplayName(mergerState.survivorName)}`;
            document.getElementById("mergerBonusSummary").textContent = `${companyDisplayName(mergerState.loserSnapshot.name)} had ${mergerState.loserSnapshot.size} tiles. Its share price was $${mergerState.loserSnapshot.price}. Bonuses: majority $${mergerState.loserSnapshot.majority}, minority $${mergerState.loserSnapshot.minority}. ${mergerState.bonusSummary || ""}`;
            document.getElementById("mergerResolutionArea").style.display = "block";
            document.getElementById("turnStatus").textContent = `Merger in progress: resolve ${companyDisplayName(mergerState.loserSnapshot.name)}'s shares before continuing.`;
            showNextMergerPlayer();
        } else {
            document.getElementById("turnStatus").textContent = "Resuming the pending merger choice.";
            startNextMerger();
        }
    } else if (pendingTurn) {
        document.getElementById("turnStatus").textContent = `${currentPlayer().name}'s saved share purchase — finish the turn when ready.`;
        showStockPurchase();
    } else {
        document.getElementById("turnStatus").textContent = `${currentPlayer().name}'s turn has been restored.`;
    }
    return true;
}

function phoneElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

async function phoneRequest(path, data) {
    const response = await fetch(path, data ? {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data)
    } : undefined);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "The request failed.");
    return result;
}

function renderPhoneJoin(errorText = "") {
    const screen = document.getElementById("phoneScreen");
    screen.replaceChildren();
    const panel = phoneElement("section", "phone-panel");
    panel.appendChild(phoneElement("h2", "", "Join the Acquire game"));
    const codeLabel = phoneElement("label", "", "Room code");
    const codeInput = document.createElement("input");
    codeInput.value = phoneJoinCode || "";
    codeInput.maxLength = 8;
    codeLabel.appendChild(codeInput);
    const nameLabel = phoneElement("label", "", "Your name");
    const nameInput = document.createElement("input");
    nameInput.maxLength = 24;
    nameInput.autocomplete = "nickname";
    nameInput.value = localStorage.getItem(`acquire.playerName.${(phoneJoinCode || networkRoomCode).toUpperCase()}`) || "";
    nameLabel.appendChild(nameInput);
    panel.append(codeLabel, nameLabel);
    const joinButton = phoneElement("button", "", "Join game");
    joinButton.addEventListener("click", async () => {
        joinButton.disabled = true;
        try {
            const joined = await phoneRequest("/api/join", {
                room: codeInput.value.trim().toUpperCase(),
                name: nameInput.value.trim(),
                clientId: phoneDeviceId
            });
            phoneToken = joined.token;
            localStorage.setItem(`acquire.player.${joined.code}`, phoneToken);
            localStorage.setItem(`acquire.playerName.${joined.code}`, nameInput.value.trim());
            connectPhone(joined.code);
        } catch (error) { renderPhoneJoin(error.message); }
    });
    panel.appendChild(joinButton);
    if (errorText || phoneError) panel.appendChild(phoneElement("p", "phone-error", errorText || phoneError));
    screen.appendChild(panel);
}

function renderPhone() {
    // State snapshots can arrive while a mouse is held down. Replacing the
    // phone screen at that moment removes the pressed tile button and cancels
    // the browser's eventual click event. Render the latest state after release.
    if (phonePointerActive) {
        phoneRenderDeferred = true;
        return;
    }
    const screen = document.getElementById("phoneScreen");
    const formContext = JSON.stringify([phoneState?.self?.id, phoneState?.pending]);
    if (formContext !== phoneFormContext) {
        phoneSelectedCompany = null;
        phoneStockSelections = {};
        phoneMergerSelections = { sell: 0, tradeShares: 0 };
    }
    phoneFormContext = formContext;
    screen.replaceChildren();
    if (!phoneState) return renderPhoneJoin();
    const player = phoneState.self;
    if (phoneState.phase === "lobby") {
        const lobby = phoneElement("section", "phone-panel");
        lobby.append(phoneElement("h2", "", player?.name || "Player connected"), phoneElement("p", "", `Room ${networkRoomCode}`));
        lobby.appendChild(phoneElement("p", "phone-status", phoneState.hostConnected ? "Connected. Waiting for the host to start the game." : "The host page is reconnecting. Your seat is saved."));
        screen.appendChild(lobby);
        return;
    }
    if (!player) return renderPhoneJoin("This phone is not connected to a player seat.");
    const heading = phoneElement("section", "phone-panel");
    heading.append(phoneElement("h2", "", player.name), phoneElement("p", "", `Room ${networkRoomCode} · $${player.money.toLocaleString()}`));
    const turnName = phoneState.players.find(item => item.id === phoneState.currentPlayerId)?.name;
    heading.appendChild(phoneElement("p", "phone-status", phoneState.phase === "finished" ? `Game over${phoneState.winners.length ? ` — ${phoneState.winners.join(" and ")} won` : ""}` : phoneState.pending?.type === "merger" && phoneState.pending.playerId === player.id ? "Resolve the merger on your phone" : phoneState.pending?.type === "choice" && phoneState.pending.playerId === player.id ? phoneState.pending.title : phoneState.pending?.type === "buy" && phoneState.pending.playerId === player.id ? "Buy shares to finish your turn" : phoneState.currentPlayerId === player.id ? "Your turn" : `${turnName || "Waiting"} is taking their turn`));
    screen.appendChild(heading);
    const portfolio = phoneElement("section", "phone-panel");
    portfolio.appendChild(phoneElement("h3", "", "Your shares"));
    const holdings = Object.entries(player.shares || {}).filter(([, count]) => count > 0).map(([name, count]) => `${companyDisplayName(name)}: ${count}`);
    portfolio.appendChild(phoneElement("p", "", holdings.join(" · ") || "No shares yet"));
    screen.appendChild(portfolio);
    const handPanel = phoneElement("section", "phone-panel");
    const tileInstruction = !phoneState.canPlay
        ? "Tile selection becomes available on your turn."
        : "Select a tile, then press Play to place it.";
    handPanel.append(phoneElement("h3", "", "Your tiles"), phoneElement("p", "", tileInstruction));
    const hand = phoneElement("div", "phone-hand");
    for (const tile of player.hand || []) {
        const button = phoneElement("button", phoneSelectedTile === tile.name ? "selected" : "", tile.name);
        button.type = "button";
        button.style.background = tile.background;
        button.title = tile.title;
        button.setAttribute("aria-label", `${tile.name}. ${tile.title}`);
        button.disabled = !phoneState.canPlay || phoneBusy || tile.unplayable;
        button.addEventListener("click", () => {
            phoneSelectedTile = tile.name;
            renderPhone();
        });
        hand.appendChild(button);
    }
    handPanel.appendChild(hand);
    if (phoneState.canPlay && phoneSelectedTile) {
        const play = phoneElement("button", "", `Play ${phoneSelectedTile}`);
        play.disabled = phoneBusy;
        play.addEventListener("click", () => sendPhoneAction({ type: "play", tile: phoneSelectedTile }));
        handPanel.appendChild(play);
    }
    screen.appendChild(handPanel);
    const pending = phoneState.pending;
    if (pending?.type === "choice" && pending.playerId === player.id) {
        const panel = phoneElement("section", "phone-panel");
        panel.appendChild(phoneElement("h3", "", pending.title));
        const choices = phoneElement("div", "phone-company-choices");
        for (const name of pending.choices) {
            const choice = phoneElement("button", `phone-company-button${phoneSelectedCompany === name ? " selected" : ""}`, companyDisplayName(name));
            choice.type = "button";
            choice.style.backgroundColor = companyColors[name] || "#ddd";
            choice.setAttribute("aria-pressed", String(phoneSelectedCompany === name));
            choice.disabled = phoneBusy;
            choice.addEventListener("click", () => { phoneSelectedCompany = name; renderPhone(); });
            choices.appendChild(choice);
        }
        const confirmText = pending.title.toLowerCase().includes("start") ? "Start company" : "Confirm choice";
        const choose = phoneElement("button", "", confirmText);
        choose.type = "button";
        choose.disabled = !phoneSelectedCompany || phoneBusy;
        choose.addEventListener("click", () => sendPhoneAction({ type: "choice", company: phoneSelectedCompany }));
        panel.append(choices, choose); screen.appendChild(panel);
    } else if (pending?.type === "buy" && pending.playerId === player.id) {
        const panel = phoneElement("section", "phone-panel");
        panel.appendChild(phoneElement("h3", "", "Buy up to 3 shares"));
        panel.appendChild(phoneElement("p", "", "Choose any mix of shares. You may buy at most 3 total, limited by cash and available stock."));
        const availableCompanies = phoneState.companies.filter(item => item.size > 0 && item.sharesLeft > 0);
        const totalSelected = () => Object.values(phoneStockSelections).reduce((total, quantity) => total + quantity, 0);
        const totalCost = () => phoneState.companies.reduce((total, company) => total + (phoneStockSelections[company.name] || 0) * company.price, 0);
        for (const company of availableCompanies) {
            const row = phoneElement("div", "phone-stock-row");
            const tile = phoneElement("div", "phone-stock-company");
            tile.style.backgroundColor = company.color || companyColors[company.name] || "#ddd";
            tile.append(phoneElement("strong", "", companyDisplayName(company.name)), phoneElement("span", "", `$${company.price} each · ${company.sharesLeft} available`));
            const stepper = phoneElement("div", "phone-stock-stepper");
            const quantity = phoneStockSelections[company.name] || 0;
            const decrement = phoneElement("button", "phone-stock-step", "−");
            decrement.type = "button";
            decrement.setAttribute("aria-label", `Buy one fewer ${companyDisplayName(company.name)} share`);
            decrement.disabled = phoneBusy || quantity <= 0;
            decrement.addEventListener("click", () => {
                phoneStockSelections[company.name] = Math.max(0, quantity - 1);
                renderPhone();
            });
            const value = phoneElement("output", "phone-stock-value", String(quantity));
            value.setAttribute("aria-label", `${quantity} ${companyDisplayName(company.name)} shares selected`);
            const increment = phoneElement("button", "phone-stock-step", "+");
            increment.type = "button";
            increment.setAttribute("aria-label", `Buy one more ${companyDisplayName(company.name)} share`);
            increment.disabled = phoneBusy || totalSelected() >= 3 || quantity >= company.sharesLeft || totalCost() + company.price > player.money;
            increment.addEventListener("click", () => {
                phoneStockSelections[company.name] = quantity + 1;
                renderPhone();
            });
            stepper.append(decrement, value, increment);
            row.append(tile, stepper);
            panel.appendChild(row);
        }
        if (!availableCompanies.length) panel.appendChild(phoneElement("p", "", "No shares are currently available."));
        panel.appendChild(phoneElement("p", "phone-stock-summary", `${totalSelected()} of 3 shares selected — $${totalCost()} total; $${player.money} cash available.`));
        const buy = phoneElement("button", "", "Finish turn");
        buy.type = "button";
        buy.disabled = phoneBusy;
        buy.addEventListener("click", () => sendPhoneAction({
            type: "buy",
            purchases: availableCompanies.map(company => ({ company: company.name, quantity: phoneStockSelections[company.name] || 0 }))
        }));
        panel.appendChild(buy); screen.appendChild(panel);
    } else if (pending?.type === "merger" && pending.playerId === player.id) {
        const panel = phoneElement("section", "phone-panel");
        panel.appendChild(phoneElement("h3", "", `${companyDisplayName(pending.loser)} is absorbed by ${companyDisplayName(pending.survivor)}`));
        panel.appendChild(phoneElement("p", "", `You have ${pending.shares} ${companyDisplayName(pending.loser)} shares. Trading uses 2 shares for each 1 ${companyDisplayName(pending.survivor)} share.`));

        const remainingShares = pending.shares - phoneMergerSelections.sell - phoneMergerSelections.tradeShares;
        const sellRow = phoneElement("div", "phone-stock-row");
        const sellTile = phoneElement("div", "phone-stock-company");
        sellTile.style.backgroundColor = companyColors[pending.loser] || "#ddd";
        sellTile.append(phoneElement("strong", "", `Sell ${companyDisplayName(pending.loser)}`), phoneElement("span", "", "1 share per step"));
        const sellStepper = phoneElement("div", "phone-stock-stepper");
        const sellDown = phoneElement("button", "phone-stock-step", "−");
        sellDown.type = "button"; sellDown.setAttribute("aria-label", `Sell one fewer ${companyDisplayName(pending.loser)} share`);
        sellDown.disabled = phoneBusy || phoneMergerSelections.sell <= 0;
        sellDown.addEventListener("click", () => { phoneMergerSelections.sell -= 1; renderPhone(); });
        const sellValue = phoneElement("output", "phone-stock-value", String(phoneMergerSelections.sell));
        sellValue.setAttribute("aria-label", `${phoneMergerSelections.sell} shares selected to sell`);
        const sellUp = phoneElement("button", "phone-stock-step", "+");
        sellUp.type = "button"; sellUp.setAttribute("aria-label", `Sell one more ${companyDisplayName(pending.loser)} share`);
        sellUp.disabled = phoneBusy || remainingShares <= 0;
        sellUp.addEventListener("click", () => { phoneMergerSelections.sell += 1; renderPhone(); });
        sellStepper.append(sellDown, sellValue, sellUp); sellRow.append(sellTile, sellStepper);

        const tradeRow = phoneElement("div", "phone-stock-row");
        const tradeTile = phoneElement("div", "phone-stock-company");
        tradeTile.style.backgroundColor = companyColors[pending.survivor] || "#ddd";
        tradeTile.append(phoneElement("strong", "", `Trade for ${companyDisplayName(pending.survivor)}`), phoneElement("span", "", `2 ${companyDisplayName(pending.loser)} shares per step · up to ${pending.maxTrades} trades`));
        const tradeStepper = phoneElement("div", "phone-stock-stepper");
        const tradeDown = phoneElement("button", "phone-stock-step", "−");
        tradeDown.type = "button"; tradeDown.setAttribute("aria-label", `Trade two fewer ${companyDisplayName(pending.loser)} shares`);
        tradeDown.disabled = phoneBusy || phoneMergerSelections.tradeShares <= 0;
        tradeDown.addEventListener("click", () => { phoneMergerSelections.tradeShares -= 2; renderPhone(); });
        const tradeValue = phoneElement("output", "phone-stock-value", String(phoneMergerSelections.tradeShares));
        tradeValue.setAttribute("aria-label", `${phoneMergerSelections.tradeShares} shares selected to trade`);
        const tradeUp = phoneElement("button", "phone-stock-step", "+");
        tradeUp.type = "button"; tradeUp.setAttribute("aria-label", `Trade two more ${companyDisplayName(pending.loser)} shares`);
        tradeUp.disabled = phoneBusy || remainingShares < 2 || phoneMergerSelections.tradeShares + 2 > pending.maxTrades * 2;
        tradeUp.addEventListener("click", () => { phoneMergerSelections.tradeShares += 2; renderPhone(); });
        tradeStepper.append(tradeDown, tradeValue, tradeUp); tradeRow.append(tradeTile, tradeStepper);

        panel.append(sellRow, tradeRow);
        panel.appendChild(phoneElement("p", "phone-stock-summary", `${remainingShares} ${companyDisplayName(pending.loser)} share${remainingShares === 1 ? "" : "s"} will be kept.`));
        const confirm = phoneElement("button", "", "Confirm and continue");
        confirm.type = "button"; confirm.disabled = phoneBusy;
        confirm.addEventListener("click", () => sendPhoneAction({ type: "merger", sell: phoneMergerSelections.sell, trade: phoneMergerSelections.tradeShares / 2 }));
        panel.appendChild(confirm); screen.appendChild(panel);
    }
    if (phoneState.phase === "lobby") screen.appendChild(phoneElement("section", "phone-panel", "You are connected. Waiting for the host to start the game."));
    const connected = phoneElement("p", "", phoneBusy ? "Waiting for the laptop to apply your action…" : "Connected to the laptop host"); connected.id = "phoneConnectionStatus"; screen.appendChild(connected);
    if (phoneError) screen.appendChild(phoneElement("p", "phone-error", phoneError));
}

async function sendPhoneAction(action) {
    if (phoneBusy) return;
    const startingRevision = Number(phoneState?.snapshotRevision) || 0;
    let resolveApplied;
    const actionApplied = new Promise(resolve => { resolveApplied = resolve; });
    const waiter = { afterRevision: startingRevision, resolve: resolveApplied };
    phoneActionWaiter = waiter;
    phoneBusy = true; renderPhone();
    try {
        const actionId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        await phoneRequest("/api/action", { room: networkRoomCode, token: phoneToken, actionId, ...action });
        if ((Number(phoneState?.snapshotRevision) || 0) <= startingRevision) await actionApplied;
        phoneError = "";
        phoneSelectedTile = null;
    } catch (error) {
        phoneError = error.message;
    } finally {
        if (phoneActionWaiter === waiter) phoneActionWaiter = null;
        phoneBusy = false;
        renderPhone();
    }
}

function connectPhone(code) {
    networkRoomCode = code;
    if (phoneEventSource) phoneEventSource.close();
    phoneEventSource = new EventSource(`/api/events?room=${encodeURIComponent(code)}&token=${encodeURIComponent(phoneToken)}`);
    phoneEventSource.addEventListener("state", event => {
        phoneState = JSON.parse(event.data);
        phoneError = "";
        if (phoneActionWaiter && Number(phoneState.snapshotRevision) > phoneActionWaiter.afterRevision) {
            phoneActionWaiter.resolve();
        }
        renderPhone();
    });
    phoneEventSource.addEventListener("kicked", event => {
        phoneEventSource?.close();
        localStorage.removeItem(`acquire.player.${code}`);
        phoneToken = "";
        phoneState = null;
        phoneError = "";
        renderPhoneJoin(JSON.parse(event.data).message);
    });
    phoneEventSource.onerror = () => { const status = document.getElementById("phoneConnectionStatus"); if (status) status.textContent = "Connection lost — reconnecting…"; };
    phoneRequest(`/api/state?room=${encodeURIComponent(code)}&token=${encodeURIComponent(phoneToken)}`).then(state => { phoneState = state; renderPhone(); }).catch(error => { localStorage.removeItem(`acquire.player.${code}`); renderPhoneJoin(error.message); });
}

async function startPhoneClient() {
    document.body.classList.add("phone-client");
    document.querySelector("header #networkRoomPanel").style.display = "none";
    for (const main of document.querySelectorAll("body > main:not(#phoneScreen)")) main.style.display = "none";
    document.querySelector("footer").style.display = "none";
    const phoneScreen = document.querySelector("#phoneScreen");
    phoneScreen.style.display = "block";
    phoneScreen.addEventListener("pointerdown", event => {
        if (event.isPrimary) phonePointerActive = true;
    });
    const finishPhonePointer = () => {
        if (!phonePointerActive) return;
        phonePointerActive = false;
        if (phoneRenderDeferred) {
            phoneRenderDeferred = false;
            requestAnimationFrame(() => renderPhone());
        }
    };
    document.addEventListener("pointerup", finishPhonePointer);
    document.addEventListener("pointercancel", finishPhonePointer);
    networkRoomCode = phoneJoinCode.toUpperCase();
    phoneDeviceId = localStorage.getItem("acquire.device.id") || "";
    if (!phoneDeviceId) {
        phoneDeviceId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
        localStorage.setItem("acquire.device.id", phoneDeviceId);
    }
    phoneToken = localStorage.getItem(`acquire.player.${networkRoomCode}`) || "";
    if (phoneToken) connectPhone(networkRoomCode);
    else renderPhoneJoin();
}

function startNetworkHost() {
    startHostNetwork();
    document.getElementById("playerSelect").addEventListener("change", () => updateHostRoomPanel({ players: remotePlayers }));
}

// The host can move past an unplayed turn or forfeit the share purchase after a tile was placed.
function skipCurrentTurn() {
    if (!networkEnabled || !playerData.length || gameOver || mergerState || remoteCompanyChoice) return;
    const skippedPlayer = currentPlayer();
    if (!skippedPlayer) return;

    const tileWasPlayed = pendingTurn;
    selectedTileName = null;
    document.getElementById("stockPurchaseArea").style.display = "none";
    if (tileWasPlayed) {
        // advanceTurn draws the replacement tile owed for the completed placement.
        advanceTurn();
    } else {
        // No placement means no replacement tile; the player's hand stays unchanged.
        pendingTurn = false;
        currentPlayerIndex = (currentPlayerIndex + 1) % playerData.length;
        recalculatePlayability();
        renderEconomy();
        takeTurn();
    }
    const nextPlayer = currentPlayer();
    document.getElementById("turnStatus").textContent = `Host skipped ${skippedPlayer.name}'s turn. ${nextPlayer?.name || "Next player"} is up.`;
    updateSkipTurnButton();
}

function beginNewGame() {
    if (mergerState || remoteCompanyChoice) return;
    if (playerData.length && !confirm("Start a new game? The saved game in progress will be replaced.")) return;

    clearSavedHostGame();
    playerCount = Number(document.getElementById("playerSelect").value) || playerCount || 2;
    gameBoard = gameBoard.map(tile => ({ ...tile, ownership: "unassigned", holderId: null, playability: "playable" }));
    playerData = [];
    companies.forEach(company => { company.size = 0; company.price = 0; company.majority = 0; company.minority = 0; company.sharesLeft = 25; });
    currentPlayerIndex = 0;
    selectedTileName = null;
    pendingTurn = false;
    mergerState = null;
    remoteCompanyChoice = null;
    gameOver = false;
    finalSettlement = [];

    document.getElementById("gameOverArea").style.display = "none";
    document.getElementById("stockPurchaseArea").style.display = "none";
    document.getElementById("mergerResolutionArea").style.display = "none";
    document.getElementById("startScreen").style.display = "block";
    document.getElementById("gameBoardScreen").style.display = "none";
    title.textContent = "Welcome to Acquire";
    persistHostRoomSession(remotePlayers);
    renderEconomy();
    updateHostRoomPanel({ players: remotePlayers });
}

// Show share options when possible; skip this phase if there are no shares or none are affordable.
function showStockPurchase() {
    const player = currentPlayer();
    const availableCompanies = availableStockCompanies();
    const cheapestPrice = cheapestAvailableStockPrice();
    if (!availableCompanies.length || cheapestPrice > player.money) {
        advanceTurn();
        return;
    }

    pendingTurn = true;
    persistHostGame();
    const area = document.getElementById("stockPurchaseArea");
    const options = document.getElementById("stockPurchaseOptions");
    options.innerHTML = "";
    // Only display companies for which the player can currently afford at least one share.
    const affordableCompanies = availableCompanies.filter(company => company.price <= player.money);
    const activeCompanies = affordableCompanies;
    for (const company of activeCompanies) {
        const row = document.createElement("label");
        row.className = "purchase-row";
        const description = document.createElement("span");
        description.textContent = `${companyDisplayName(company.name)}: $${company.price} each (${company.sharesLeft} available)`;
        const marker = document.createElement("span");
        marker.className = "company-color-dot";
        marker.style.backgroundColor = companyColors[company.name];
        marker.setAttribute("aria-hidden", "true");
        const quantity = document.createElement("input");
        quantity.type = "number";
        quantity.min = "0";
        quantity.max = String(Math.min(3, company.sharesLeft));
        quantity.step = "1";
        quantity.value = "0";
        quantity.dataset.company = company.name;
        quantity.setAttribute("aria-label", `Number of ${companyDisplayName(company.name)} shares to buy`);
        quantity.addEventListener("input", updatePurchaseSummary);
        row.append(marker, description, quantity);
        options.appendChild(row);
    }
    area.style.display = "block";
    updatePurchaseSummary();
    renderHand();
    persistHostGame();
    publishNetworkSnapshot();
}

// Recalculate the selected share count and cost as the player changes the quantity inputs.
function updatePurchaseSummary() {
    const player = currentPlayer();
    if (!player) return;
    let totalShares = 0;
    let totalCost = 0;
    for (const input of document.querySelectorAll("#stockPurchaseOptions input")) {
        const quantity = Math.max(0, Number(input.value) || 0);
        const company = companies.find(item => item.name === input.dataset.company);
        totalShares += quantity;
        totalCost += quantity * (company?.price || 0);
    }
    const message = `${totalShares} of 3 shares selected — total $${totalCost}; cash available: $${player.money}.`;
    document.getElementById("stockPurchaseSummary").textContent = message;
}

// Validate share purchases, subtract their cost, and hand the turn to the next player.
function finishTurn() {
    if (!pendingTurn) return;
    const player = currentPlayer();
    let purchases = [];
    let totalShares = 0;
    let totalCost = 0;
    // Validate every company quantity before changing any cash or share totals.
    for (const input of document.querySelectorAll("#stockPurchaseOptions input")) {
        const quantity = Number(input.value);
        const company = companies.find(item => item.name === input.dataset.company);
        if (!Number.isInteger(quantity) || quantity < 0 || !company || quantity > company.sharesLeft) {
            document.getElementById("stockPurchaseSummary").textContent = "Enter a whole number of shares that the company still has available.";
            return;
        }
        if (quantity > 0) purchases.push({ company, quantity });
        totalShares += quantity;
        totalCost += quantity * company.price;
    }
    if (totalShares > 3) {
        document.getElementById("stockPurchaseSummary").textContent = "You can buy at most 3 shares total per turn.";
        return;
    }
    if (totalCost > player.money) {
        document.getElementById("stockPurchaseSummary").textContent = "You do not have enough cash for that purchase.";
        return;
    }

    for (const { company, quantity } of purchases) {
        player.money -= quantity * company.price;
        player.shares[company.name] += quantity;
        company.sharesLeft -= quantity;
    }
    advanceTurn();
}

// Draw a replacement tile for the player who just played, then activate the next player.
function advanceTurn() {
    const player = currentPlayer();
    const replacement = unassignedTile();
    if (replacement) {
        const replacementTile = gameBoard.find(item => item.name === replacement);
        replacementTile.ownership = "hand";
        replacementTile.holderId = player.id;
        player.playerTiles.push(replacement);
    }
    currentPlayerIndex = (currentPlayerIndex + 1) % playerData.length;
    pendingTurn = false;
    mergerState = null;
    recalculatePlayability();
    renderEconomy();
    takeTurn();
}

// A fresh game resets all state, builds/deals the board, then begins with the first player.
document.getElementById("startGameButton").onclick = function() {
    if (networkEnabled && (remotePlayers.length !== Number(document.getElementById("playerSelect").value) || remotePlayers.some(player => !player.connected))) {
        document.getElementById("networkPlayers").textContent = `Connect exactly ${document.getElementById("playerSelect").value} phones before starting.`;
        return;
    }
    // Reset existing tile objects so a second game can be started without reloading the page.
    gameBoard = gameBoard.map(tile => ({ ...tile, ownership: "unassigned", holderId: null, playability: "playable" }));
    playerData = [];
    // Companies return to their not-yet-founded state with all 25 shares available.
    companies.forEach(company => { company.size = 0; company.price = 0; company.majority = 0; company.minority = 0; company.sharesLeft = 25; });
    currentPlayerIndex = 0;
    selectedTileName = null;
    pendingTurn = false;
    mergerState = null;
    gameOver = false;
    document.getElementById("gameOverArea").style.display = "none";
    startGame();
    initiateGameBoard(gameBoardHeight, gameBoardWidth); // This initializes the game board
    // If a player cancels entering their name, return them to setup instead of starting half a game.
    if (!initiatePlayerData()) {
        document.getElementById("startScreen").style.display = "block";
        document.getElementById("gameBoardScreen").style.display = "none";
        title.innerText = "Welcome to Acquire";
        return;
    }
    syncCompanySizes();
    recalculatePlayability();
    takeTurn();
    updateHostRoomPanel({ players: remotePlayers });
};
// Connect the page's action buttons to the functions that handle their clicks.
document.getElementById("finishTurnButton").onclick = finishTurn;
document.getElementById("resolveMergerPlayerButton").onclick = resolveMergerPlayer;
document.getElementById("endGameButton").onclick = endGame;
document.getElementById("skipTurnButton").onclick = skipCurrentTurn;
document.getElementById("newGameButton").onclick = beginNewGame;

if (isPhoneClient) startPhoneClient();
else startNetworkHost();
