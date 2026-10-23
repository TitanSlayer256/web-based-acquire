# Acquire local multiplayer

The existing game continues to run in the laptop browser. Node.js provides a room, phone connections, reconnect tokens, and a message relay for player actions; game rules and turn sequencing remain in the original `script.js`.

## Run the host

1. Install Node.js 18 or newer on the laptop.
2. Open PowerShell in this folder and run `node server.js`.
3. Keep the terminal open, then open `http://localhost:3000` on the laptop.
4. Choose the number of players in the original setup screen. Each player opens one of the phone links shown in the page header, enters their name, and joins.
5. Start the game after all selected player phones show as connected.

The server prints every detected IPv4 address. If a phone cannot open its link, try another listed Wi-Fi or Ethernet address. All devices need to be on a network that allows devices to reach one another; allow Node.js through the Windows firewall for the active private network.

Player seats stay on the laptop server while a phone refreshes or reconnects. The laptop game page and Node process must remain open. Restarting either one does not restore an active game.
