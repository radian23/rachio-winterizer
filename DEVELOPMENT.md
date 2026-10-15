# Development record

Created October 14, 2026 for `radian23`'s irrigation workflow.

Requirements were developed in conversation: eight zones, configurable short timed
runs (normally 30 seconds), an adjustable combined recovery/cooldown interval,
repeat passes, cancellation, bounded execution, explicit errors, countdown, and
estimated completion. No compressor motor sensing or switching is included.

Before this implementation, AlexOnAPeak/rachio-winterizer was reviewed and a separate
local modification was tested. That repository had no license at the reviewed commit.
The current implementation was written in a new directory, without copying its source,
assets, styling, tests, or the earlier patch. A different interface, module organization,
API wrapper, plan representation and session implementation were written for this
project. Published API endpoint names and request fields follow Rachio's documentation.
The author of this implementation had seen the earlier code, so this record does not
claim a formal clean-room process or make a legal determination about copyright.

The earlier download, modified prototype, and associated review artifacts remain outside
this directory and are not part of the intended GitHub repository. The functional idea
of cycling sprinkler zones with recovery waits is shared by other irrigation tools;
no exclusive ownership of that idea is claimed.

AI coding assistance was used. Users should review and try simulation before operating
real equipment. Testing has not sent any commands to a real controller.
