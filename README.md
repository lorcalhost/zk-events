
<img src="https://i.imgur.com/Y9xd6Mq.png" width="250">

# ZK Events

A Mina zkApp that allows users to create events, create a whitelist of people who can purchase the tickets and lets people prove ticket ownership at the venue.

## General architecture description

Each event has its own smart contract which stores a merkle root for the whitelist. The merkle root is updated whenever a new user is added to the whitelist. The smart contract also stores a merkle root for the current owners of the tickets. The smart contract also stores the event details and the ticket price.  
The zkApp also generates a ticket QR code containing merkle tree data that can be used to prove ownership at the venue.

## Progress

- [x] Figure out general architecture
- [x] QR code generation
- [ ] QR code generation with merkle tree data
- [ ] Event generation
- [ ] Event generation with whitelist
- [ ] Prove ticket ownership
- [ ] Allow users to trade tickets before the event

## Useful Links

- Snarky merkle tree: https://github.com/Comdex/snarky-smt
- Documentation: https://o1-labs.github.io/snarkyjs/index.html

## Notes
The zkApp is still actively under development.  
This project is being built as part of Mina's zkApp Builders Program.
