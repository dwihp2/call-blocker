# The Backup file holds Block rules only

A Backup file could carry both lists and come back complete, but an Allow list is often just the person's contacts copied out by hand, so exporting it moves contact-derived data onto another device and into whatever storage the person drops the file in. We decided the file holds Block rules only. Consequences: Restore offers Merge or Replace and never touches the Allow list that is already on the device, and a Restore onto a new phone comes back without the Allow exceptions that used to protect wanted numbers, so Restore says so on its preview screen.
