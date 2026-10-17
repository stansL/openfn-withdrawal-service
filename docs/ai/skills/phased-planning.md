# Phased planning for larger changes

Follow [the protocol](../CHANGE_PROTOCOL.md); a clear request still authorizes narrow work. Use this guidance when a change spans several boundaries or requires migration. Routine fixes need only the existing short task plan.

For each phase name the user-visible outcome, state owner, files/callers/contracts, invariants at risk, public test boundary, verification commands, compatibility/rollback considerations and completion criteria. Separate automated evidence from manual checks. Each phase should deliver a small working slice with tests rather than completing all layers separately.

Resolve policy or material scope decisions before dependent work. Use fresh independent review where the protocol requires it; delegation is optional, not a default agent roster. Never mark manual criteria complete on the user's behalf. Finish with verification and the existing human gate; do not commit automatically.
