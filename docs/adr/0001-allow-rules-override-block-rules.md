# Allow rules override Block rules, whatever the size of either pattern

A number can match several Rules at once (a Block prefix and an Allow single number, or an Allow prefix and a Block single number). We decided the Allow list always wins, regardless of how specific either pattern is, because any specificity ranking produces decisions the person cannot predict. The cost is that a wide Allow prefix can shadow a narrow Block rule, which is why Registration warns about Overlaps.

*Amended 2026-10-07.* The exception this decision used to carry — a Single number Block rule beating the Contacts allowance — went with the Contacts allowance itself (ADR 0007). Allow rules are now the only thing that overrides a Block rule.
