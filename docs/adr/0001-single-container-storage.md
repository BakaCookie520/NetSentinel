# Single application runtime with selectable business storage

Status: accepted

The deployment consists of one application container, not bundled database
servers. SQLite is built in; PostgreSQL and Redis refer to external services.
The selected backend stores all business entities and durable tasks.

A typed Store/UnitOfWork interface is the storage seam. PostgreSQL retains its
Prisma schema and migration history; SQLite stores relational scalar columns
and runs transactional work in a dedicated thread; Redis uses individual
namespaced records and query indexes with a durable rollback journal.
Redis is not a Prisma emulation layer or a serialized copy of the entire site.

The application process owns probes, workflow execution, Agent connections and
SSE. There is no required external BullMQ queue. A process lock plus backend
ownership lease prevents multiple active runtimes. Remote effects whose outcome
is uncertain are never automatically replayed.

New installs require a one-time setup token and recovery-key acknowledgement;
TOTP is optional. Existing PostgreSQL installs retain accounts and business data.
Account recovery keys, TOTP backup codes, deployment encryption keys and backup
passphrases are distinct secrets with distinct purposes.

The logical backup format, rather than the physical backend schema, defines
portable backup compatibility. Data sources are fixed after installation;
moving to another backend requires backup/restore into a new instance.
