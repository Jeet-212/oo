/* Mode definitions: form fields + prompt builders for every MUN mode. */

const WPM = 140; // natural speaking pace
const wordsFor = (secs) => Math.round((secs * WPM) / 60);

const BASE_SYSTEM = `You are MUN Desk, an elite Model United Nations coach, researcher and speechwriter. You have competed in and chaired UNA-USA, THIMUN, HMUN-style and Indian-circuit conferences, including crisis committees.

Rules:
- Write clear, confident diplomatic English. Use Markdown: headings, bullets, bold for key lines, tables where useful.
- Speeches are written in the delegate's voice ("The delegation of X..."), formal and persuasive, and ready to read aloud.
- Be factually careful. Cite real UN resolutions, treaties, reports, votes and statistics only when confident. When unsure, mark it "(verify)" instead of inventing numbers, dates or quotes.
- Represent the delegation's real-world foreign policy accurately unless the user says otherwise.
- No filler and no meta-commentary about being an AI. Every line should be usable in committee.`;

/* Reusable fields */
const F = {
  country: { id: 'country', label: 'Country / Delegation', type: 'text', placeholder: 'e.g. India', required: true, shared: true },
  committee: { id: 'committee', label: 'Committee', type: 'text', placeholder: 'e.g. UNSC, DISEC, UNHRC, WHO', required: true, shared: true },
  agenda: { id: 'agenda', label: 'Agenda', type: 'textarea', rows: 2, placeholder: 'e.g. Addressing the militarisation of outer space', required: true, shared: true, full: true },
  extra: {
    id: 'extra', label: 'Additional info (optional)', type: 'textarea', rows: 4, full: true,
    placeholder: "Anything else: chair's background guide notes, your bloc, points you must include, what other delegates said, conference rules...",
  },
};

const sel = (id, label, options, def) => ({ id, label, type: 'select', options, default: def ?? options[0] });

/* Build the "inputs" block of a prompt, skipping empty values */
function inputs(v, pairs) {
  return pairs
    .filter(([, key]) => v[key] && String(v[key]).trim())
    .map(([label, key]) => `- **${label}:** ${String(v[key]).trim()}`)
    .join('\n');
}

const extraLine = (v) => (v.extra && v.extra.trim() ? `\n\nAdditional context from the delegate (treat as high priority):\n"""\n${v.extra.trim()}\n"""` : '');

const timeNote = (secs) =>
  `Target length: ${secs} seconds ≈ ${wordsFor(secs)} words at ~${WPM} words per minute. Stay within ±10%.`;

const SPEECH_REFINE = ['Make it more assertive', 'Cut 15 seconds', 'Stronger opening hook', 'Add a real statistic', 'More diplomatic tone'];

const MODES = [
  /* ───────────── RESEARCH ───────────── */
  {
    id: 'research',
    name: 'Research',
    cta: 'Generate research dossier',
    icon: '🔎',
    desc: 'Get a full research dossier on your country, committee and agenda, with live Google Search sources where available.',
    grounding: true,
    fields: [
      F.country, F.committee, F.agenda,
      sel('depth', 'Depth', ['Extensive', 'Standard', 'Quick brief']),
      sel('format', 'Conference style', ['General', 'UNA-USA', 'THIMUN', 'Indian circuit', 'Crisis committee']),
      F.extra,
    ],
    refine: ['Go deeper on my country\'s voting record', 'Give me 5 more mod caucus topics', 'Draft 3 operative clauses', 'Who are my likely allies?', 'Make a 1-page cheat sheet'],
    system: `${BASE_SYSTEM}

You are now in RESEARCH mode. Produce a thorough, well-organised research dossier a delegate can study before committee. Use live search results when available and cite them. Prefer recent data (state the year).`,
    build: (v) => {
      const depth = {
        Extensive: 'Be exhaustive: go deep in every section, aiming for 2,000+ words.',
        Standard: 'Be thorough but focused, roughly 1,000–1,500 words.',
        'Quick brief': 'Be concise, roughly 500 words, bullets only.',
      }[v.depth] || '';
      return `Prepare a MUN research dossier.

${inputs(v, [['Delegation', 'country'], ['Committee', 'committee'], ['Agenda', 'agenda'], ['Conference style', 'format']])}

${depth}

Use exactly these sections:
1. **Executive summary**: 5 bullets the delegate can memorise.
2. **Agenda background**: history, key events and turning points, current situation with dates and figures.
3. **Committee mandate**: what ${v.committee} can and cannot do on this issue (powers, limits, relevant past actions).
4. **Key UN & international documents**: resolutions, treaties, conventions, reports (with numbers and years).
5. **${v.country}'s position**: official stance, voting record, statements by leaders or the Permanent Representative, domestic laws and policies, national interests and red lines.
6. **Bloc analysis**: a table of likely allies, opponents and swing states, with a one-line reason for each.
7. **Key stakeholders**: NGOs, regional bodies and agencies involved.
8. **Debate map**: 6–8 strong moderated caucus topics this agenda will likely produce.
9. **Solutions**: realistic solutions aligned with ${v.country}'s stance, plus 5 draft operative clause ideas (with proper operative verbs).
10. **Expected attacks**: tough questions or POIs other delegates may throw at ${v.country}, with sharp answers.
11. **Opening speech**: a 60–75 second opening GSL speech draft.
12. **Further research**: what the delegate should still look up.

End with a **Sources** list.${extraLine(v)}`;
    },
  },

  /* ───────────── USA UNA ───────────── */
  {
    id: 'usauna',
    name: 'USA UNA',
    icon: '🎤',
    desc: 'Write moderated caucus and speakers\' list speeches in UNA-USA procedure.',
    subs: [
      {
        id: 'mod',
        name: 'MODs',
        cta: 'Write mod speech',
        desc: 'Moderated caucus speeches that stay on the caucus topic and move debate forward.',
        fields: [
          F.country, F.committee, F.agenda,
          { id: 'topic', label: 'Moderated caucus topic', type: 'text', placeholder: 'e.g. Funding mechanisms for climate refugees', required: true, full: true },
          sel('time', 'Speaking time', ['30', '45', '60', '90'], '45'),
          sel('goal', 'Goal of this speech', ['Introduce my position', 'Propose a solution', 'Rebut other delegations', 'Build a coalition / call for allies', 'Summarise & push toward a resolution']),
          { id: 'points', label: 'Points to include (optional)', type: 'textarea', rows: 2, full: true, placeholder: 'Specific arguments, stats or delegations to reference' },
          F.extra,
        ],
        refine: SPEECH_REFINE,
        system: `${BASE_SYSTEM}

You are now in USA UNA mode, writing MODERATED CAUCUS speeches. In UNA-USA procedure, mod speeches are short, topic-specific and interactive. They respond to the flow of debate and do not repeat the whole national position. They have no yields. Open with a punchy hook, not "Honorable chair..." filler.`,
        build: (v) => `Write a moderated caucus speech.

${inputs(v, [['Delegation', 'country'], ['Committee', 'committee'], ['Agenda', 'agenda'], ['Mod topic', 'topic'], ['Goal', 'goal'], ['Must include', 'points']])}

${timeNote(+v.time)}

Output:
## Speech
(the speech itself, ready to read aloud)

## Why it works
3 short bullets.

## Alternate hooks
2 alternative opening lines.

## Comebacks
Likely counter-arguments from other delegations, each with a one-line comeback.${extraLine(v)}`,
      },
      {
        id: 'gsl',
        name: 'GSLs',
        cta: 'Write GSL speech',
        desc: 'General Speakers\' List speeches: your full position, solutions and a call to action.',
        fields: [
          F.country, F.committee, F.agenda,
          sel('time', 'Speaking time', ['60', '90', '120'], '90'),
          sel('stage', 'Speech type', ['Opening speech (first GSL)', 'Mid-debate GSL', 'Closing / pre-voting GSL']),
          sel('tone', 'Tone', ['Diplomatic', 'Assertive', 'Persuasive', 'Emotional / humanitarian']),
          { id: 'points', label: 'Points to include (optional)', type: 'textarea', rows: 2, full: true, placeholder: 'Specific arguments, stats or delegations to reference' },
          F.extra,
        ],
        refine: [...SPEECH_REFINE, 'Give me a 60-second version'],
        system: `${BASE_SYSTEM}

You are now in USA UNA mode, writing GENERAL SPEAKERS' LIST speeches. A GSL speech states the delegation's position, its national context and its proposed solutions, and ends with a call to action. In UNA-USA procedure, leftover time may be yielded (to the chair, to another delegate or to questions). Suggest the best yield at the end.`,
        build: (v) => `Write a General Speakers' List speech.

${inputs(v, [['Delegation', 'country'], ['Committee', 'committee'], ['Agenda', 'agenda'], ['Speech type', 'stage'], ['Tone', 'tone'], ['Must include', 'points']])}

${timeNote(+v.time)}

Structure the speech as: hook → why this matters globally → ${v.country}'s stance & actions → 2–3 concrete solutions → call to action to the committee.

Output:
## Speech
(ready to read aloud)

## Suggested yield
What to yield to and why.

## 30-second cut
A condensed version for when time is short.

## Delivery notes
Where to pause, which words to stress, and eye-contact moments.${extraLine(v)}`,
      },
    ],
  },

  /* ───────────── QUICK ───────────── */
  {
    id: 'quick',
    name: 'Quick',
    icon: '⚡',
    desc: 'Ask anything: procedure, points and motions, a fast fact check, a POI, a clause, or a last-minute idea.',
    chat: true,
    grounding: true,
    suggestions: [
      'Difference between a moderated and unmoderated caucus?',
      'Write 3 sharp POIs to ask China on cybersecurity',
      'When can I raise a Right of Reply?',
      'Turn this idea into an operative clause: ',
      'List common preambulatory and operative phrases',
    ],
    system: `${BASE_SYSTEM}

You are now in QUICK mode: a fast MUN assistant for any query. Answer directly and concisely by default. Expand only when the question needs it. If a question depends on conference-specific rules, give the common convention and note it may vary.`,
  },

  /* ───────────── PROVISIONAL ───────────── */
  {
    id: 'provisional',
    name: 'Provisional',
    icon: '🏛️',
    desc: 'Consultation of the Whole and Open Debate formats, written in the structure each one expects.',
    subs: [
      {
        id: 'consultation',
        name: 'Consultation',
        cta: 'Prepare consultation',
        desc: 'Short, reactive interventions for Consultation of the Whole / informal consultations.',
        fields: [
          F.country, F.committee, F.agenda,
          { id: 'topic', label: 'Consultation topic / focus', type: 'text', placeholder: 'e.g. Accountability for cross-border cyberattacks', required: true, full: true },
          sel('time', 'Time per intervention', ['30', '45', '60'], '45'),
          sel('count', 'Number of interventions', ['4', '6', '8'], '6'),
          F.extra,
        ],
        refine: ['Make the interventions more aggressive', 'Add interventions responding to the USA', 'Add 3 more questions to ask', 'Make them shorter'],
        system: `${BASE_SYSTEM}

You are now in PROVISIONAL mode, writing for a CONSULTATION OF THE WHOLE. In a consultation, delegates speak in quick, informal rounds without a fixed speakers' list. Interventions are short and reactive: they respond to others, ask questions, build on ideas and steer debate. Use conversational but diplomatic language. No long salutations.`,
        build: (v) => `Prepare me for a Consultation of the Whole.

${inputs(v, [['Delegation', 'country'], ['Committee', 'committee'], ['Agenda', 'agenda'], ['Consultation topic', 'topic']])}

Each intervention: ${timeNote(+v.time)}

Output:
## Opening intervention
Sets ${v.country}'s direction for the consultation.

## Intervention bank
${v.count} distinct interventions, each labelled by situation (e.g. "If a P5 member blocks…", "To support an ally's idea…", "To redirect debate toward…").

## Questions to ask other delegations
5 pointed questions, each naming a likely target delegation.

## Rebuttal one-liners
6 quick lines for when ${v.country} is criticised.

## Steering strategy
How to keep ${v.country} at the centre of the consultation and move it toward a working paper.${extraLine(v)}`,
      },
      {
        id: 'opendebate',
        name: 'Open Debate',
        cta: 'Write statement',
        desc: 'A formal open debate statement in full UN structure.',
        fields: [
          F.country, F.committee, F.agenda,
          { id: 'focus', label: 'Debate focus / concept note theme (optional)', type: 'text', placeholder: 'e.g. Protection of civilians in urban warfare', full: true },
          sel('time', 'Speaking time', ['60', '90', '120', '180'], '120'),
          sel('tone', 'Tone', ['Diplomatic', 'Assertive', 'Persuasive', 'Emotional / humanitarian']),
          F.extra,
        ],
        refine: [...SPEECH_REFINE, 'Add references to past resolutions'],
        system: `${BASE_SYSTEM}

You are now in PROVISIONAL mode, writing an OPEN DEBATE statement. Open debates follow UN Security Council and General Assembly practice. The statement is formal: thank the presidency, align with group statements where relevant, set out the national position, reference UN frameworks, propose concrete steps and close formally.`,
        build: (v) => `Write an open debate statement.

${inputs(v, [['Delegation', 'country'], ['Committee', 'committee'], ['Agenda', 'agenda'], ['Debate focus', 'focus'], ['Tone', 'tone']])}

${timeNote(+v.time)}

Structure:
1. Formal opening and thanks to the presidency / briefers
2. Alignment with a group statement (if ${v.country} realistically belongs to one, e.g. NAM, G77, EU, AU)
3. Framing of the issue with one strong fact
4. ${v.country}'s national position and actions taken
5. References to relevant UN resolutions or frameworks
6. 3 concrete proposals
7. Formal closing

Output:
## Statement
(ready to deliver)

## Key references used
List each, with "(verify)" if uncertain.

## Likely responses
How 3 other key delegations will probably respond, and how to handle each.${extraLine(v)}`,
      },
    ],
  },

  /* ───────────── CRISIS ───────────── */
  {
    id: 'crisis',
    name: 'Crisis',
    icon: '🚨',
    desc: 'Write your own crisis, speak in crisis consultations and Special Speakers\' Lists, or solve a crisis with directives.',
    subs: [
      {
        id: 'writer',
        name: 'Crisis Writer',
        cta: 'Build my crisis',
        desc: 'Design a complete crisis committee: premise, portfolios, timeline and escalating updates.',
        fields: [
          sel('ctype', 'Committee type', ['UNSC crisis', 'Historical crisis', 'Futuristic / sci-fi', 'Fictional universe', 'Joint Crisis Committee (JCC)', 'National cabinet', 'Corporate / boardroom']),
          { id: 'setting', label: 'Setting / era', type: 'text', placeholder: 'e.g. 1962 Cuba, 2045 Arctic, Westeros', required: true },
          { id: 'premise', label: 'Theme / premise', type: 'textarea', rows: 3, full: true, required: true, placeholder: 'What is the core conflict? e.g. A rogue AI takes control of a nation\'s nuclear grid' },
          sel('portfolios', 'Number of portfolios', ['8', '12', '16', '20', '25'], '16'),
          sel('difficulty', 'Difficulty', ['Intermediate', 'Beginner-friendly', 'Advanced']),
          sel('updates', 'Crisis updates to write', ['5', '8', '10'], '8'),
          F.extra,
        ],
        refine: ['Add a major plot twist', 'Write 3 more crisis updates', 'Give every portfolio a secret agenda', 'Write the background guide in full', 'Make it darker'],
        system: `${BASE_SYSTEM}

You are now in CRISIS WRITER mode: a veteran crisis director designing committees that are fair, dramatic and playable. Every portfolio must have meaningful powers and a reason to clash. Updates must escalate, react to likely directives and leave room for delegates to act.`,
        build: (v) => `Design a complete crisis committee.

${inputs(v, [['Committee type', 'ctype'], ['Setting / era', 'setting'], ['Premise', 'premise'], ['Number of portfolios', 'portfolios'], ['Difficulty', 'difficulty']])}

Output:
## Title & tagline
## Background guide
The world, the situation, the stakes (400–600 words).
## Timeline
Key events leading up to the start of committee.
## Portfolios
A table of all ${v.portfolios} portfolios: name, role, powers, public goal, **secret agenda**.
## Opening situation
What the chair reads at the start of session 1.
## Crisis updates
${v.updates} escalating updates, each with: trigger/timing, the update text as it would be read aloud, intended effect on debate, and the directives it is likely to provoke.
## Twists in reserve
3 twists the crisis staff can deploy.
## Win conditions & endings
Possible endings depending on committee choices.
## Crisis staff notes
How to handle backroom directives, pacing tips, and how to keep quiet delegates involved.${extraLine(v)}`,
      },
      {
        id: 'ssl',
        name: 'Consultation & SSL',
        cta: 'Prepare my response',
        desc: 'React to a live crisis update with a Special Speakers\' List speech and crisis consultation interventions.',
        fields: [
          F.committee,
          { id: 'portfolio', label: 'Your country / portfolio', type: 'text', placeholder: 'e.g. Russian Federation, or Minister of Defence', required: true },
          { id: 'update', label: 'Crisis update (paste it)', type: 'textarea', rows: 5, full: true, required: true, placeholder: 'Paste the crisis update exactly as the chair or crisis staff gave it' },
          sel('need', 'What do you need?', ['Both SSL speech + consultation points', 'SSL speech only', 'Consultation interventions only']),
          sel('time', 'SSL speaking time', ['45', '60', '90'], '60'),
          F.extra,
        ],
        refine: ['Make it more urgent', 'Add a proposal for a joint directive', 'Respond to the delegate who just attacked me', 'Cut it to 30 seconds'],
        system: `${BASE_SYSTEM}

You are now in CRISIS CONSULTATION & SSL mode. A Special Speakers' List (SSL) opens in response to a crisis update. Speeches must react immediately to the update, condemn or support specific actions, state what the portfolio will do and push the committee toward a response. Crisis consultations are fast and informal, built from short reactive interventions. Sound urgent, decisive and in character.`,
        build: (v) => `A crisis update just dropped. Prepare my response.

${inputs(v, [['Committee', 'committee'], ['My portfolio', 'portfolio'], ['What I need', 'need']])}

Crisis update:
"""
${v.update}
"""

${v.need !== 'Consultation interventions only' ? `SSL speech — ${timeNote(+v.time)}\n` : ''}
Output:
## 10-second read
What this update means for ${v.portfolio}: threats, opportunities, who benefits.
${v.need !== 'Consultation interventions only' ? '## SSL speech\n(ready to read aloud)\n' : ''}${v.need !== 'SSL speech only' ? '## Consultation interventions\n5 short interventions (15–30 seconds each), each labelled with when to use it.\n' : ''}
## Immediate actions
3 directives or actions ${v.portfolio} should send right now, each in one line.
## Watch out
Which delegates will likely move against you, and how.${extraLine(v)}`,
      },
      {
        id: 'solver',
        name: 'Crisis Solver',
        cta: 'Solve this crisis',
        desc: 'Paste a crisis and get a full strategy: analysis, directives, communiqués and a long-term arc.',
        fields: [
          F.committee,
          { id: 'portfolio', label: 'Your country / portfolio', type: 'text', placeholder: 'e.g. Director of the CIA', required: true },
          { id: 'powers', label: 'Your portfolio powers (optional)', type: 'textarea', rows: 2, full: true, placeholder: 'e.g. Control of intelligence assets, covert ops budget, access to the President' },
          { id: 'situation', label: 'Crisis situation', type: 'textarea', rows: 5, full: true, required: true, placeholder: 'Paste the current crisis, updates so far and what has already happened in committee' },
          { id: 'objective', label: 'Your objectives / secret agenda (optional)', type: 'textarea', rows: 2, full: true, placeholder: 'What you are secretly trying to achieve' },
          F.extra,
        ],
        refine: ['Write the private directives in more detail', 'Plan my next 3 sessions', 'What if my directive fails?', 'Write a press release', 'Make my arc more ruthless'],
        system: `${BASE_SYSTEM}

You are now in CRISIS SOLVER mode: a championship crisis delegate and strategist. Think several moves ahead. Directives must be specific (who, what, how, with what resources, and a contingency), realistic within the portfolio's powers and written in standard MUN directive format. Balance public cooperation with private, arc-building moves.`,
        build: (v) => `Solve this crisis for my portfolio.

${inputs(v, [['Committee', 'committee'], ['My portfolio', 'portfolio'], ['Powers', 'powers'], ['Objectives / secret agenda', 'objective']])}

Crisis situation:
"""
${v.situation}
"""

Output:
## Situation analysis
Actors, interests, threats, leverage, and what the crisis staff is probably testing.
## Strategy
The overall plan in 3–4 bullets (public face vs private aims).
## Directives
- **2 public / committee directives** (full text: title, sponsors, actions, resources)
- **2 private / personal directives** (full text, with a contingency for each)
- **1 joint directive** to propose to an ally (name a likely partner)
## Communiqué / press release
A short in-character statement to issue.
## Crisis arc
Where to take ${v.portfolio} over the next 2–3 sessions.
## Contingencies
If X happens → do Y (4 scenarios).${extraLine(v)}`,
      },
    ],
  },
];
