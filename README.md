<img src="https://i.imgur.com/Y9xd6Mq.png" width="250">

# ZK Events

A Mina zkApp that allows users to create events using a whitelist of people that can claim the tickets, and lets people prove ticket(s) ownership at the venue.

## General architecture description

Each event has its own smart contract which stores a merkle root for the whitelist. The merkle tree is pre-setup with leaves for the whitelisted users. The merkle tree is updated whenever user claims or trades a ticket.
The zkApp also generates a ticket QR code containing data that can be used to prove ownership at the venue.

## Progress

### V1

- [x] Figure out general architecture
- [x] Event generation with whitelist
- [x] Ticket claiming if in whitelist
- [x] Gameify console interaction
- [x] Limits on total number of tickets and claimable per user and in total
- [x] Prove ticket ownership function
- [x] Allow users to trade tickets
- [x] QR code generation
- [x] Separate into multiple files
- [x] Write tests
- [ ] Fix WL const handling
- [ ] More concise tests
- [ ] Add security feature and timestamp to `sendTicket`

### V2

- [ ] Hide more data
- [ ] QR code with less identifiable data
- [ ] Create verifier program to run at the event
- [ ] Frontend

## How to run

Run in interactive mode:

```sh
npm run interactive
```

Run tests:

```sh
npm run test
```

## Useful Links

- Snarky sparse merkle tree: https://github.com/Comdex/snarky-smt
- Snarkyjs documentation: https://o1-labs.github.io/snarkyjs/index.html

## Notes

The zkApp is still actively under development.  
This project is being built as part of Mina's zkApp Builders Program.
