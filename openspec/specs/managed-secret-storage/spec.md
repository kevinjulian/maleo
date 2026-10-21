# managed-secret-storage Specification

## Purpose

Where operator-supplied credentials live, how they are encrypted, which key
encrypts them and where that key comes from, the precedence between an
environment variable and a stored value, and the rule that a stored secret is
never readable back over HTTP.

Written because configuration was edited by hand in a `.env` file that a
container restart discards, so a non-technical operator had no way to set a
provider up and no way to make it stick.

## Requirements

### Requirement: Operator-Supplied Secrets Are Stored Encrypted At Rest

A secret supplied through the settings surface SHALL be encrypted with an
authenticated cipher before it is written. A secret SHALL NOT be written in
plaintext.

Secrets SHALL be encrypted under a stored data key, and that data key SHALL itself
be stored encrypted under a master key. A secret SHALL NOT be encrypted under the
master key directly.

The master key SHALL be taken from the environment when one is supplied there, and
otherwise from owner-only storage outside the database — generated on first use if
absent. The environment SHALL take precedence, so a deployment that names its own
key keeps exactly that key.

Generating one is safe only because it is written down before it is used. The
failure this guards is a process inventing a key per boot, which leaves every
secret it wrote unreadable after a restart; that comes from a key that cannot
persist, not from generating one.

Wrapping the data key is what keeps master key rotation to a single row. Encrypting
secrets under the master key directly would make rotation a bulk re-encryption
whose partial failure leaves a database half-readable under each key.

The runtime database is the file an operator backs up, copies between machines,
and attaches to a bug report. A `.env` is understood to be secret; a `.db` is
treated as data. Encryption is what makes that difference safe, and it is why the
master key lives OUTSIDE the database — it is precisely the thing a database dump
must not contain. A key file beside the database still satisfies that: it protects
a dumped or shared database, not a copied volume.

#### Scenario: Storing a secret

- **WHEN** an operator saves a value declared as a secret
- **THEN** the stored bytes are ciphertext, and the plaintext appears nowhere in
  the database

#### Scenario: Reading a secret for use

- **WHEN** a provider resolves a secret it needs in order to run
- **THEN** the value is decrypted in memory for that use

#### Scenario: No master key exists yet

- **WHEN** an operator saves a secret and no master key exists in the environment
  or on disk
- **THEN** one is generated, written to owner-only storage BEFORE it is used, and
  the secret is stored under it

#### Scenario: A generated key is reused

- **WHEN** a later secret is saved
- **THEN** the key already written is used, never a fresh one — a key invented per
  use would leave everything written under the previous one unreadable

#### Scenario: Reading does not create a key

- **WHEN** a secret is read, or the store's status is reported, and no key exists
- **THEN** no key is generated, because asking whether something is configured
  must not be what configures it

#### Scenario: A key can be neither read nor written

- **WHEN** no master key is in the environment and one cannot be written
- **THEN** the write is refused naming both, rather than encrypting under a key
  that will not exist next time

#### Scenario: A secret cannot be decrypted

- **WHEN** a stored secret cannot be decrypted because the master key is absent or
  has changed
- **THEN** the surface reports that cause against the affected provider, rather
  than reporting the provider as unconfigured and presenting the loss as an
  operator error

### Requirement: The Master Key Can Be Rotated Without Reconfiguring Anything

The settings surface SHALL offer generating a new master key. Rotation SHALL
re-wrap the stored data key and SHALL NOT require an operator to re-enter any
provider configuration.

An operator who rotates a key and is then asked to set up every provider again
will not rotate keys.

#### Scenario: Rotating the master key

- **WHEN** an operator generates a new master key
- **THEN** the stored data key is re-wrapped under it, every stored secret remains
  decryptable, and every provider stays configured and active

#### Scenario: The new key is shown once

- **WHEN** rotation produces a new master key
- **THEN** it is displayed once for the operator to save, and no later request
  returns it

### Requirement: Rotation Leaves No Window In Which A Restart Loses Access

A rotation SHALL complete without a restart when the system can itself place the
new key where the next process will look for it — a key kept in owner-only storage
this application writes. No key SHALL be shown and no confirmation SHALL be asked
for, because there is nothing for an operator to do.

When the key is supplied by the environment, the system cannot place it. There the
stored data key SHALL remain unwrappable by both the previous and the new master
key until a startup proves the new key is present, and the previous wrapping SHALL
be discarded only after that proof.

The environment is fixed at process start, so the running application cannot
confirm the operator placed the new key until it next boots. Discarding the old
wrapping before then makes a restart at the wrong moment lose every stored secret.
Asking for that confirmation when the system already placed the key itself is not
caution — it is a step an operator cannot complete and need not have been offered.

#### Scenario: Rotating a key the system keeps itself

- **WHEN** the master key is held in storage this application writes and a rotation
  is requested
- **THEN** it completes immediately, no key is returned, nothing is reported as
  pending, and every stored secret stays readable

#### Scenario: The previous key stops working

- **WHEN** such a rotation completes
- **THEN** the previous key no longer opens the store, and exactly one wrapping
  remains

#### Scenario: Restart with the old key mid-rotation

- **WHEN** the application restarts after rotation with the previous master key
  still in the environment
- **THEN** it starts normally, every secret is readable, and rotation is still
  reported as incomplete

#### Scenario: Restart with the new key

- **WHEN** the application restarts with the new master key in the environment
- **THEN** every secret is readable, the previous wrapping is discarded, and
  rotation is reported complete

#### Scenario: Rotation is not reported as done before it is

- **WHEN** rotation has occurred but no startup has proven the new key is in the
  environment
- **THEN** the surface continues to show the new key and an unconfirmed state,
  because reporting success here would be discovered as false only at the next
  deployment

### Requirement: Every Key State Has A Way Out

A state the operator cannot leave SHALL NOT exist. Specifically:

- A rotation that cannot be completed SHALL be abandonable, keeping the key
  currently in force and every secret readable.
- Encrypted storage that no available key can open SHALL be discardable, so
  credentials can be entered again.

Neither SHALL happen automatically. A key that does not match is far more often a
misconfiguration than a loss, and discarding on sight would destroy secrets the
correct key could still open.

Without these, the surface prints remedies it does not offer: a rotation completes
only on a restart carrying the new key, so losing that key before saving it leaves
a pending state forever; and "re-enter the credentials" is impossible while the
envelope cannot be opened, because every write fails against it too.

#### Scenario: Abandoning a rotation that cannot be finished

- **WHEN** an operator discards a pending rotation
- **THEN** the key in force is kept, every stored secret stays readable, and the
  pending state is cleared

#### Scenario: The abandoned key stops working

- **WHEN** a rotation is abandoned
- **THEN** the key it produced no longer opens the store

#### Scenario: Abandoning cannot strand the store

- **WHEN** the key in force is not among the stored wrappings
- **THEN** abandoning is refused, because dropping the other wrapping would leave
  nothing that opens

#### Scenario: Discarding storage no key can open

- **WHEN** an operator confirms discarding unreadable storage
- **THEN** it is removed, and a credential saved afterwards is readable

#### Scenario: Discarding is refused when nothing is unreadable

- **WHEN** the current key can read what is stored
- **THEN** discarding is refused, so it cannot become a way to lose working
  credentials

#### Scenario: A mismatch alone destroys nothing

- **WHEN** the master key does not match and no operator has confirmed anything
- **THEN** every stored secret is left intact, and restoring the correct key makes
  them readable again

### Requirement: A Stored Secret Is Never Returned Over HTTP

No endpoint SHALL return a stored secret's plaintext. A response describing a
secret SHALL report only whether it is set and a masked form of it.

Write-only is the property that survives mistakes. A read endpoint that exists
"for the settings form" is the one a future surface, log line, or error body will
eventually leak through.

#### Scenario: Reading a provider's configuration

- **WHEN** a provider's configuration is fetched for display
- **THEN** each secret field reports that it is set and a masked value, and no
  response carries the plaintext

#### Scenario: Editing a secret that is already set

- **WHEN** an operator opens a provider whose secret is already stored
- **THEN** the input is empty with an indication that a value is stored, and
  saving without entering anything leaves the stored value unchanged

#### Scenario: Clearing a secret

- **WHEN** an operator removes a stored secret
- **THEN** removal is an explicit action, and is not expressed by submitting an
  empty field

### Requirement: Stored Secrets Are Addressed Under A Reserved Namespace

A stored secret SHALL be keyed under a reserved prefix that distinguishes it from
an ordinary application setting. A general-purpose settings listing SHALL exclude
that namespace.

The settings table is a bare key-value store shared with non-secret values. Without
a namespace, one careless listing endpoint returns every secret, and nothing in the
code makes that mistake visible at the point it is written.

#### Scenario: Listing application settings

- **WHEN** application settings are listed by a general-purpose reader
- **THEN** no key under the secret namespace is included

#### Scenario: A secret and a setting share a concept

- **WHEN** a provider stores both an endpoint and a credential
- **THEN** they are addressed under different namespaces, and only the credential
  is encrypted

### Requirement: Environment Variables Take Precedence Over Stored Values

Configuration SHALL resolve environment first, then stored value, then unset. A
stored value SHALL NOT override an environment variable.

A deployment configured entirely by environment variables must keep working
untouched, with no master key and no migration, and an operator must retain a way
to override the database from outside it.

#### Scenario: Both are set

- **WHEN** a value exists in both the environment and storage
- **THEN** the environment value is used

#### Scenario: Only the stored value is set

- **WHEN** a value exists only in storage
- **THEN** the stored value is used, with no restart required

#### Scenario: An existing environment-only deployment

- **WHEN** a deployment sets every value by environment variable and configures no
  master key
- **THEN** it resolves every value as it did before this change

### Requirement: The database is reached by credential, not by file access

Access to the runtime database SHALL require a credential. The application SHALL
NOT depend on filesystem permissions to restrict who can read stored secrets.

#### Scenario: A process on the host attempts access

- **WHEN** a process on the application host attempts to read the runtime database without the credential
- **THEN** access is refused

#### Scenario: The connection crosses a host boundary

- **WHEN** the database is not on the same host as the application
- **THEN** the connection is encrypted

### Requirement: The master key is supplied to the process, not stored with the data

In a deployment, the master key wrapping the data key SHALL be supplied through
the process environment or a secret manager, and SHALL NOT be stored in the
database it protects or on a volume alongside it.

A key stored beside the data it protects is carried along with any copy of that
data. This is already the documented precedence — the environment wins over the
file — and a deployment makes it the only supported form.

#### Scenario: A deployment starts

- **WHEN** the application starts in production
- **THEN** the master key is read from the environment, and no key file is created

#### Scenario: A database backup is obtained

- **WHEN** someone obtains a copy of the database or its backup
- **THEN** stored secrets remain encrypted, because the key is not in it

#### Scenario: The master key is absent in production

- **WHEN** the application starts in production with no master key supplied
- **THEN** it fails at startup naming the missing key rather than generating one
