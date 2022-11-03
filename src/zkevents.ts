import {
  SmartContract,
  isReady,
  shutdown,
  Poseidon,
  Field,
  Experimental,
  Permissions,
  DeployArgs,
  State,
  state,
  CircuitValue,
  PublicKey,
  UInt64,
  prop,
  Mina,
  method,
  UInt32,
  PrivateKey,
  AccountUpdate,
} from 'snarkyjs';

import QRCode from 'qrcode';

await isReady;

// very slow on M1 macs if enabled
const doProofs = false;

//! TODO get from input and gameify
const whitelistSize = 8;
const maxNumberOfTicketsPerAccount = 2;
const maxTicketsPerEvent = 100;

class MerkleWitness extends Experimental.MerkleWitness(whitelistSize) {}

class Account extends CircuitValue {
  @prop publicKey: PublicKey;
  @prop tickets: UInt32;

  constructor(publicKey: PublicKey, tickets: UInt32) {
    super(publicKey, tickets);
    this.publicKey = publicKey;
    this.tickets = tickets;
  }

  hash(): Field {
    return Poseidon.hash(this.toFields());
  }

  addTicket(n: number): Account {
    return new Account(this.publicKey, this.tickets.add(n));
  }

  removeTicket(n: number): Account {
    if (this.tickets.lt(new UInt32(n))) {
      throw new Error('underflow');
    }
    return new Account(this.publicKey, this.tickets.sub(n));
  }

  // nOfTickets(): UInt32 {
  //   return this.tickets;
  // }
}

let initialCommitment: Field = Field.zero;

class ZKEvent extends SmartContract {
  @state(Field) commitment = State<Field>();

  deploy(args: DeployArgs) {
    super.deploy(args);
    this.setPermissions({
      ...Permissions.default(),
      editState: Permissions.proofOrSignature(),
    });
    this.balance.addInPlace(UInt64.fromNumber(initialBalance));
    this.commitment.set(initialCommitment);
  }

  @method
  claimTicket(account: Account, path: MerkleWitness) {
    let commitment = this.commitment.get();
    this.commitment.assertEquals(commitment);

    // check that account is within the committed Merkle Tree (or whitelist)
    path.calculateRoot(account.hash()).assertEquals(commitment);

    //!TODO: check if already has already maximum allowed number of tickets per person via builtin const
    account.tickets.assertLt(UInt32.fromNumber(maxNumberOfTicketsPerAccount));

    //!TODO: check if already has already maximum allowed number of tickets per event

    let newAccount = account.addTicket(1);

    // calculate new merkle root
    let newCommitment = path.calculateRoot(newAccount.hash());

    this.commitment.set(newCommitment);
  }
}

type Names = 'Alice' | 'Bob' | 'Carol' | 'Dave';

let Local = Mina.LocalBlockchain();
Mina.setActiveInstance(Local);
let initialBalance = 10_000_000_000;

let feePayer = Local.testAccounts[0].privateKey;

// zkapp account
let zkappKey = PrivateKey.random();
let zkappAddress = zkappKey.toPublicKey();

// this map serves as our off-chain in-memory storage
let Accounts: Map<string, Account> = new Map<Names, Account>();

let alice = new Account(Local.testAccounts[0].publicKey, UInt32.from(0));
let bob = new Account(Local.testAccounts[1].publicKey, UInt32.from(0));
let carol = new Account(Local.testAccounts[2].publicKey, UInt32.from(0));
let dave = new Account(Local.testAccounts[3].publicKey, UInt32.from(0));

Accounts.set('Alice', alice);
Accounts.set('Bob', bob);
Accounts.set('Carol', carol);
Accounts.set('Dave', dave);

// we now need "wrap" the Merkle tree around our off-chain storage
// we initialize a new Merkle Tree with height whitelistSize
const Tree = new Experimental.MerkleTree(whitelistSize);

Tree.setLeaf(0n, alice.hash());
Tree.setLeaf(1n, bob.hash());
Tree.setLeaf(2n, carol.hash());
Tree.setLeaf(3n, dave.hash());

// generate initial commitment with whitelist
initialCommitment = Tree.getRoot();

let zkEventsZkApp = new ZKEvent(zkappAddress);
console.log('Deploying event..');
if (doProofs) {
  await ZKEvent.compile();
}
let tx = await Mina.transaction(feePayer, () => {
  AccountUpdate.fundNewAccount(feePayer, { initialBalance });
  zkEventsZkApp.deploy({ zkappKey });
});
await tx.send();

console.log('Alice initial tickets: ' + Accounts.get('Alice')?.tickets);

console.log('Alice is claiming a ticket..');
await claimTicket('Alice', 0n);

console.log('Alice final tickets: ' + Accounts.get('Alice')?.tickets);

setTimeout(shutdown, 0);

async function claimTicket(name: Names, index: bigint) {
  let account = Accounts.get(name)!;
  let w = Tree.getWitness(index);
  let witness = new MerkleWitness(w);

  let tx = await Mina.transaction(feePayer, () => {
    zkEventsZkApp.claimTicket(account, witness);
    if (!doProofs) zkEventsZkApp.sign(zkappKey);
  });
  if (doProofs) {
    await tx.prove();
  }
  await tx.send();

  // if the transaction was successful, we can update our off-chain storage as well
  account.tickets = account.tickets.add(1);
  let accHash = account.hash();
  Tree.setLeaf(index, accHash);
  console.log(accHash.toString());
  QRCode.toString(
    //! TODO use useful data in QR code
    accHash.toString(),
    { type: 'terminal' },
    function (err, url) {
      console.log(url);
    }
  );
  zkEventsZkApp.commitment.get().assertEquals(Tree.getRoot());
}
