## REMOVED Requirements

### Requirement: A client-scoped Requirement can be created standalone or linked to a Project

Retired: `WorkItem` creation now absorbs this shape directly (see `work-item-model`'s "A Work Item
is creatable directly for a Client, with only Type and Title mandatory"). There is no longer a
separate Requirement object or a Requirement→WorkItem conversion step.

### Requirement: A Requirement's core fields can be edited before SDD activation

Retired: editing a WorkItem's title/description is already covered by `work-item-model`'s existing
"Editable fields exclude status" requirement.

### Requirement: A Requirement can be declined

Retired: no replacement decline mechanism is introduced for WorkItem — the roadmap source does not
request one.

### Requirement: A client's Requirements are listable and individually retrievable

Retired: superseded by `clients-hub`'s WORK ITEMS section and the WorkItem detail screen
(`/work-items/[id]/360`).

### Requirement: A write-capable user can explicitly start SDD from an open Requirement

Retired: "Start SDD" as a distinct gating action is removed. A WorkItem's Pipeline start remains
available directly from the WorkItem detail screen, subject to the same Constitution-approval gate
as before — unchanged, just no longer preceded by a separate Requirement-activation step.
