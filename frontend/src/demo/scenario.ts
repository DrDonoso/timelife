/**
 * The demo family: Emma (born March 2024) and Leo (born September 2025) with their milestones,
 * photos and the people invited to the timeline. English adaptation of the local development
 * data in src/timelife/demo.py, extended by one more year.
 *
 * Dates are written for {@link REFERENCE_DAY} and move forward by whole years as time passes, so
 * the timeline always reaches the visitor's today while birthdays, Halloween and Christmas keep
 * their calendar dates. Milestones after today are left out (the extra year of content fills the
 * gap until the next shift). Deterministic: the same day always gives the same scenario.
 */
import type { CategoryOut } from '../api/schema.gen'
import { shiftISODate, toISODate } from '../utils/dates'
import { Random } from './random'

/** The day the dates below are written for; the scenario shifts by whole years from it. */
export const REFERENCE_DAY = '2026-10-21'
const SEED = 20240310

export type Scene = 'park' | 'beach' | 'home' | 'party' | 'night' | 'meal' | 'school' | 'play' | 'christmas'
export type ChildSlug = 'emma' | 'leo'
export type CategoryKey =
  | 'general'
  | 'academic'
  | 'teething'
  | 'language'
  | 'sleep'
  | 'gross-motor'
  | 'fine-motor'
  | 'cognitive'
  | 'social-emotional'
  | 'feeding'
  | 'self-care'

type CategorySeed = Omit<CategoryOut, 'id' | 'sort_order' | 'key'> & { key: CategoryKey }

/** The default categories, as src/timelife/seed.py creates them on first start. */
export const CATEGORIES: readonly CategorySeed[] = [
  { key: 'general', name_es: 'General', name_en: 'General', name_pt: 'Geral', icon: 'star', color: '#64748b' },
  { key: 'academic', name_es: 'Académico', name_en: 'Academic', name_pt: 'Académico', icon: 'school', color: '#4f46e5' },
  { key: 'teething', name_es: 'Dentición', name_en: 'Teething', name_pt: 'Dentição', icon: 'dental', color: '#14b8a6' },
  {
    key: 'language',
    name_es: 'Lenguaje y comunicación',
    name_en: 'Language & communication',
    name_pt: 'Linguagem e comunicação',
    icon: 'message-circle',
    color: '#f59e0b',
  },
  { key: 'sleep', name_es: 'Sueño', name_en: 'Sleep', name_pt: 'Sono', icon: 'moon', color: '#8b5cf6' },
  { key: 'gross-motor', name_es: 'Motricidad gruesa', name_en: 'Gross motor skills', name_pt: 'Motricidade global', icon: 'walk', color: '#ef4444' },
  { key: 'fine-motor', name_es: 'Motricidad fina', name_en: 'Fine motor skills', name_pt: 'Motricidade fina', icon: 'hand-finger', color: '#f97316' },
  {
    key: 'cognitive',
    name_es: 'Desarrollo cognitivo',
    name_en: 'Cognitive development',
    name_pt: 'Desenvolvimento cognitivo',
    icon: 'brain',
    color: '#3b82f6',
  },
  {
    key: 'social-emotional',
    name_es: 'Desarrollo social y emocional',
    name_en: 'Social & emotional development',
    name_pt: 'Desenvolvimento social e emocional',
    icon: 'heart-handshake',
    color: '#ec4899',
  },
  { key: 'feeding', name_es: 'Alimentación', name_en: 'Feeding', name_pt: 'Alimentação', icon: 'baby-bottle', color: '#22c55e' },
  {
    key: 'self-care',
    name_es: 'Autonomía y cuidado personal',
    name_en: 'Independence & self-care',
    name_pt: 'Autonomia e cuidados pessoais',
    icon: 'shirt',
    color: '#06b6d4',
  },
]

export interface ChildSpec {
  slug: ChildSlug
  name: string
  /** Birth date on the reference day's calendar. */
  birthDate: string
  /** Avatar portrait: background gradient, hair and shirt colours, pigtails or a quiff. */
  background: readonly [string, string]
  hair: string
  shirt: string
  pigtails: boolean
}

export const CHILDREN: readonly ChildSpec[] = [
  { slug: 'emma', name: 'Emma', birthDate: '2024-03-10', background: ['#fbcfe8', '#fde68a'], hair: '#5b3a29', shirt: '#f472b6', pigtails: true },
  { slug: 'leo', name: 'Leo', birthDate: '2025-09-18', background: ['#bae6fd', '#bbf7d0'], hair: '#a0703c', shirt: '#60a5fa', pigtails: false },
]

export interface Milestone {
  /** Date on the reference day's calendar. */
  date: string
  children: readonly ChildSlug[]
  title: string
  /** Primary category first. */
  categories: readonly CategoryKey[]
  scene: Scene
  photos: number
  notes: string
  location: string | null
  /** Names of the first photos (generic ones of the scene follow). */
  captions: readonly string[]
}

const E: readonly ChildSlug[] = ['emma']
const L: readonly ChildSlug[] = ['leo']
const BOTH: readonly ChildSlug[] = ['emma', 'leo']
const HOSPITAL = 'Riverside Maternity Unit'
const GRANDPARENTS = "Grandma and Grandpa's house, Cornwall"
const NURSERY = 'Little Acorns Nursery'
const PARK = 'Victoria Park'
const ST_IVES = 'Porthminster Beach, St Ives'
const POOL = 'Leisure centre pool'

function milestone(
  date: string,
  children: readonly ChildSlug[],
  title: string,
  categories: readonly CategoryKey[],
  scene: Scene,
  photos: number,
  notes = '',
  location: string | null = null,
  captions: readonly string[] = [],
): Milestone {
  return { date, children, title, categories, scene, photos, notes, location, captions }
}

/** In date order. Everything after {@link REFERENCE_DAY} is the extra year of content. */
export const MILESTONES: readonly Milestone[] = [
  milestone('2024-03-10', E, 'Welcome, Emma!', ['general', 'social-emotional'], 'home', 4,
    "Born at 7:42 in the morning, weighing 7 lb 1 oz. You're finally here!", HOSPITAL, ['Newborn', 'First cuddle', 'With Mum']),
  milestone('2024-03-13', E, 'First day at home', ['general'], 'home', 3,
    'We showed her the nursery and she was asleep within a minute.', null, ['Coming home', 'In her cot']),
  milestone('2024-03-24', E, 'First bath', ['self-care'], 'home', 2,
    'She cried at first, then decided that warm water is wonderful.', null, ['In the bath', 'Wrapped in a towel']),
  milestone('2024-04-14', E, 'First smile', ['social-emotional'], 'home', 3,
    'A real smile, looking at Dad while he sang to her.', null, ['The smile', 'Looking at Dad']),
  milestone('2024-05-02', E, 'Lifts her head during tummy time', ['gross-motor'], 'play', 2,
    'Holds her head up high for a few seconds on the play mat.'),
  milestone('2024-05-20', E, 'First belly laughs', ['social-emotional', 'language'], 'home', 1,
    'Raspberries on her tummy make her giggle every single time.', null, ['Giggling']),
  milestone('2024-06-08', E, 'First trip to the seaside', ['general'], 'beach', 5,
    'Her first long car journey. She slept almost the whole way.', ST_IVES, ['Looking at the sea', 'In her sun hat']),
  milestone('2024-06-15', E, 'Rolls over', ['gross-motor'], 'play', 1,
    'From her back to her tummy, and she looked so surprised!'),
  milestone('2024-06-28', E, 'Grabs her rattle', ['fine-motor'], 'play', 2),
  milestone('2024-07-10', E, 'Sleeps through the night', ['sleep'], 'night', 0,
    "Nine till seven without a peep. We couldn't believe it."),
  milestone('2024-07-22', E, 'Babbles "ba-ba-ba"', ['language'], 'home', 1,
    'Spends the whole morning chatting to her soft toys.'),
  milestone('2024-08-15', E, 'First splash in the pool', ['gross-motor', 'general'], 'beach', 4,
    "Armbands on, and never letting go of Mum's hand.", GRANDPARENTS),
  milestone('2024-09-05', E, 'First fruit purée', ['feeding'], 'meal', 4,
    'Banana, pear and orange. Her face at the first spoonful was priceless.', null, ['The first spoonful', 'Surprised face']),
  milestone('2024-09-21', E, 'Sits up without support', ['gross-motor'], 'play', 2),
  milestone('2024-10-02', E, 'First tooth', ['teething'], 'home', 1,
    'A bottom front tooth, after a few restless nights.', null, ['The first tooth']),
  milestone('2024-10-02', E, 'First night in her own room', ['sleep'], 'night', 0,
    'Baby monitor on, and the two of us peeking in every half hour.'),
  milestone('2024-10-15', E, 'Pincer grasp', ['fine-motor'], 'meal', 2,
    'Picks up peas one at a time between her thumb and finger.'),
  milestone('2024-10-31', E, 'First Halloween costume', ['social-emotional'], 'party', 3,
    'Dressed as a pumpkin for the street party.', null, ['The cutest pumpkin']),
  milestone('2024-11-08', E, 'Crawls for the first time', ['gross-motor'], 'play', 3,
    "Backwards first, then forwards. There's no stopping her now!"),
  milestone('2024-11-20', E, 'Knows her name', ['cognitive', 'language'], 'home', 0,
    'Turns around as soon as we call her, even in the middle of playing.'),
  milestone('2024-12-06', E, 'Second and third teeth', ['teething'], 'home', 0),
  milestone('2024-12-24', E, 'First Christmas Eve', ['general'], 'christmas', 3,
    'Hung up her stocking and left a mince pie out for Father Christmas.', null, ['Her stocking']),
  milestone('2024-12-25', E, 'First Christmas', ['general', 'social-emotional'], 'christmas', 6,
    'The whole family together. She liked the wrapping paper more than the presents.', GRANDPARENTS,
    ['The Christmas tree', 'With Grandma and Grandpa', 'Opening presents']),
  milestone('2025-01-18', E, 'Pulls herself up on the sofa', ['gross-motor'], 'play', 2),
  milestone('2025-02-14', E, 'First word: "Mama"', ['language'], 'home', 2,
    'Loud and clear, looking right at Mum. Dad is still waiting for his turn.'),
  milestone('2025-02-14', E, 'Claps her hands', ['fine-motor', 'social-emotional'], 'play', 1,
    'Claps every time her favourite song comes on.'),
  milestone('2025-03-03', E, 'First day at nursery', ['academic', 'social-emotional'], 'school', 4,
    "Walked in holding her key worker's hand without looking back. We were the ones who cried.", NURSERY,
    ['The new book bag', 'At the door']),
  milestone('2025-03-10', E, 'First birthday!', ['general', 'social-emotional'], 'party', 6,
    'A party with grandparents, aunts, uncles and cousins.', null, ['Blowing out the candle', 'With the balloons']),
  milestone('2025-03-10', E, 'First taste of cake', ['feeding'], 'party', 2,
    'Sugar-free carrot cake. She ended up with cream on her eyebrows.'),
  milestone('2025-03-22', E, 'First steps', ['gross-motor'], 'park', 5,
    "Three steps all by herself, straight into Dad's arms.", PARK, ['First steps!', 'Holding hands']),
  milestone('2025-04-05', E, 'Feeds herself finger food', ['feeding', 'fine-motor'], 'meal', 2),
  milestone('2025-04-19', E, 'Points at what she wants', ['cognitive', 'language'], 'home', 0,
    'Points at her cup, her books and the front door.'),
  milestone('2025-05-03', E, 'First go on the swings', ['gross-motor', 'social-emotional'], 'park', 3,
    "She didn't want to get off.", PARK),
  milestone('2025-05-17', E, 'Shape sorter success', ['cognitive', 'fine-motor'], 'play', 2,
    'The circle and the square first time; the triangle is still a mystery.'),
  milestone('2025-06-07', E, 'Says "more" and "yum"', ['language'], 'meal', 1),
  milestone('2025-06-21', E, "First sleepover at Grandma and Grandpa's", ['sleep', 'social-emotional'], 'night', 2,
    'She slept beautifully. Grandma and Grandpa, not so much.', GRANDPARENTS),
  milestone('2025-07-12', E, 'Beach holiday', ['general'], 'beach', 6,
    'A week of sand, waves and naps in the shade.', 'Woolacombe Beach, Devon', ['Sandcastles', 'By the water']),
  milestone('2025-07-26', E, 'Gives up her dummy', ['sleep', 'self-care'], 'night', 0,
    'She left it for the Dummy Fairy to take to a new baby. Two rough nights and done.'),
  milestone('2025-08-23', E, 'First ice cream', ['feeding'], 'park', 3,
    'Strawberry. She held out her hand for more.'),
  milestone('2025-09-08', E, 'Back to nursery', ['academic'], 'school', 2, '', NURSERY),
  milestone('2025-09-18', L, 'Welcome, Leo!', ['general', 'social-emotional'], 'home', 4,
    'Born at 4:05 in the afternoon, weighing 7 lb 11 oz. Calm and very sleepy.', HOSPITAL, ['Newborn', 'First cuddle']),
  milestone('2025-09-19', BOTH, 'Brother and sister meet', ['social-emotional'], 'home', 5,
    'Emma kissed his head and said "baby". A moment to frame.', HOSPITAL, ['Brother and sister', 'The first kiss']),
  milestone('2025-09-22', L, 'First day at home', ['general'], 'home', 3,
    'Emma showed him all her toys, one by one.'),
  milestone('2025-10-04', E, 'Eats with a spoon', ['feeding', 'self-care', 'fine-motor'], 'meal', 2,
    'Soup included: half in her mouth and half on her bib.'),
  milestone('2025-10-05', L, 'First bath', ['self-care'], 'home', 2),
  milestone('2025-10-24', L, 'First smile', ['social-emotional'], 'home', 2,
    "For his sister, who wouldn't stop pulling faces at him."),
  milestone('2025-10-25', E, 'Two-word sentences', ['language'], 'home', 0,
    '"More water", "Daddy come", "baby crying".'),
  milestone('2025-11-08', E, 'Scribbles with crayons', ['fine-motor', 'cognitive'], 'school', 2,
    'Her first masterpiece is already on the fridge.'),
  milestone('2025-11-15', L, 'Follows toys with his eyes', ['cognitive'], 'play', 1),
  milestone('2025-11-29', L, 'Lifts his head', ['gross-motor'], 'play', 1),
  milestone('2025-12-13', E, 'Nursery nativity play', ['academic', 'social-emotional'], 'christmas', 4,
    'Dressed as a star. She waved at the audience through the whole song.', NURSERY),
  milestone('2025-12-20', L, 'First belly laughs', ['social-emotional'], 'home', 2),
  milestone('2025-12-24', BOTH, 'Christmas Eve', ['general'], 'christmas', 3,
    "Emma hung Leo's stocking next to hers and left a carrot out for the reindeer."),
  milestone('2025-12-25', BOTH, 'Christmas together', ['general', 'social-emotional'], 'christmas', 6,
    'Our first Christmas as a family of four. Emma helped Leo open his presents (and a few more).', GRANDPARENTS,
    ['Both by the tree', 'Christmas dinner']),
  milestone('2026-01-17', L, 'Rolls over', ['gross-motor'], 'play', 1),
  milestone('2026-02-07', E, 'Counts to three', ['cognitive'], 'play', 0,
    'One, two… three! And again from the top.'),
  milestone('2026-02-07', L, 'Grabs his toys', ['fine-motor'], 'play', 2),
  milestone('2026-02-21', E, 'First haircut', ['self-care'], 'home', 3,
    'Sat very still while watching cartoons.', 'Snip & Curl, High Street'),
  milestone('2026-02-28', L, 'Sleeps through the night', ['sleep'], 'night', 0,
    'Finally! Twelve hours straight.'),
  milestone('2026-03-10', E, 'Two today!', ['general', 'social-emotional'], 'party', 5,
    "Chocolate cake and a cardboard crown she wouldn't take off all day."),
  milestone('2026-03-14', L, 'Babbles non-stop', ['language'], 'home', 0),
  milestone('2026-03-21', L, 'First purée', ['feeding'], 'meal', 3,
    'Vegetables. He liked them more than his sister ever did.'),
  milestone('2026-03-28', E, 'Jumps with both feet', ['gross-motor'], 'park', 2),
  milestone('2026-04-04', L, 'Sits up on his own', ['gross-motor'], 'play', 2),
  milestone('2026-04-18', L, 'First tooth', ['teething'], 'home', 1,
    'Bottom front, just like his sister.'),
  milestone('2026-04-25', E, 'Out of nappies in the daytime', ['self-care'], 'home', 0,
    'A whole week without accidents. Superstar!'),
  milestone('2026-05-09', BOTH, 'First trip to the zoo', ['general', 'cognitive'], 'park', 6,
    'Emma loved the giraffes; Leo fell asleep at the penguins.', 'Cotswold Wildlife Park', ['The giraffes', 'The penguins']),
  milestone('2026-05-30', L, 'Crawls', ['gross-motor'], 'play', 2,
    "Straight for his sister's toys."),
  milestone('2026-06-20', E, 'Does a six-piece puzzle', ['cognitive', 'fine-motor'], 'play', 2),
  milestone('2026-06-27', BOTH, 'Family holiday', ['general'], 'beach', 6,
    'Two weeks by the sea. Leo tasted the sand (literally).', 'Tenby, Pembrokeshire', ['Brother and sister by the water']),
  milestone('2026-07-18', E, 'Swims with armbands', ['gross-motor'], 'beach', 2, '', POOL),
  milestone('2026-07-25', L, 'First word: "Dada"', ['language'], 'home', 1,
    'Dad finally got his turn.'),
  milestone('2026-08-08', E, 'Moves to a big-girl bed', ['sleep'], 'night', 1),
  milestone('2026-08-29', L, 'Pincer grasp', ['fine-motor'], 'meal', 0),
  milestone('2026-09-01', L, 'First day at nursery', ['academic', 'social-emotional'], 'school', 3,
    'Same nursery as his sister, who showed him where to hang his coat.', NURSERY),
  milestone('2026-09-07', E, 'Moves up to the Butterflies room', ['academic'], 'school', 2, '', NURSERY),
  milestone('2026-09-18', L, 'First birthday!', ['general', 'social-emotional'], 'party', 5,
    'Emma blew out the candle for him.', null, ['With the balloons']),
  milestone('2026-09-18', L, 'First taste of cake', ['feeding'], 'party', 2),
  milestone('2026-09-19', E, 'Gets dressed by herself', ['self-care'], 'home', 1,
    'Shoes on the wrong feet, but all by herself.'),
  milestone('2026-10-03', BOTH, 'Emma reads Leo a story', ['language', 'social-emotional'], 'home', 2,
    'She makes up half of it, and Leo listens spellbound.'),
  milestone('2026-10-10', L, 'First steps', ['gross-motor'], 'park', 4,
    'Four steps to his sister, who celebrated more than anyone.', PARK),
  milestone('2026-10-17', E, 'Rides her trike', ['gross-motor'], 'park', 3, '', PARK),
  // One more year: shown as the visitor's today moves past the reference day.
  milestone('2026-10-24', L, 'Says "Emmy"', ['language', 'social-emotional'], 'home', 1,
    "His first go at his sister's name. She has answered to Emmy ever since."),
  milestone('2026-10-31', BOTH, 'Halloween dress-up', ['social-emotional', 'general'], 'party', 4,
    'Emma was a witch with a wobbly hat; Leo was the smallest pumpkin on the street.', null, ['Witch and pumpkin', 'Trick or treat']),
  milestone('2026-11-07', E, 'Draws a face', ['fine-motor', 'cognitive'], 'school', 2,
    'Two eyes, a big smile and lots of hair. "That\'s Mummy."'),
  milestone('2026-11-14', L, 'Climbs onto the sofa', ['gross-motor'], 'home', 1,
    'And straight back down again, head first, if we let him.'),
  milestone('2026-11-21', L, 'Stacks three blocks', ['fine-motor', 'cognitive'], 'play', 2,
    'Then knocks them over with a huge grin.'),
  milestone('2026-11-28', E, 'Counts to ten', ['cognitive'], 'play', 1,
    'Skipping seven every single time.'),
  milestone('2026-12-05', E, 'Pretend tea party', ['social-emotional', 'cognitive'], 'home', 3,
    'Invisible cups of tea for everyone, all afternoon. Leo got the biggest cup.', null, ['Tea for two']),
  milestone('2026-12-12', L, 'Waves bye-bye', ['social-emotional', 'language'], 'home', 1),
  milestone('2026-12-17', E, 'Second nativity play', ['academic', 'social-emotional'], 'christmas', 3,
    'A sheep this year, and she said her line loud and clear.', NURSERY),
  milestone('2026-12-24', BOTH, 'Christmas Eve baking', ['general'], 'christmas', 3,
    'Emma decorated biscuits for Father Christmas; Leo did the taste-testing.'),
  milestone('2026-12-25', BOTH, 'Christmas Day', ['general', 'social-emotional'], 'christmas', 6,
    'Leo spent most of the morning inside the biggest box.', GRANDPARENTS, ['Christmas morning', 'The biggest box']),
  milestone('2027-01-09', L, 'Feeds himself with a spoon', ['feeding', 'self-care', 'fine-motor'], 'meal', 2,
    'More porridge on the floor than in his mouth, but he insists on doing it himself.'),
  milestone('2027-01-23', E, 'Recognises her name', ['cognitive', 'academic'], 'school', 1,
    'Spotted the E on her coat peg: "That\'s me!"', NURSERY),
  milestone('2027-02-06', L, 'Points to his nose', ['cognitive', 'language'], 'home', 0,
    'Nose, ears and tummy. Eyes are still a work in progress.'),
  milestone('2027-02-13', E, 'Dry at night', ['self-care', 'sleep'], 'night', 0,
    'Two weeks of dry nights. Proud as anything.'),
  milestone('2027-02-27', L, 'Runs!', ['gross-motor'], 'park', 2,
    'Wobbly, fast and very pleased with himself.', PARK),
  milestone('2027-03-10', E, 'Three today!', ['general', 'social-emotional'], 'party', 6,
    'A unicorn cake and a garden party with her nursery friends.', null, ['The unicorn cake', 'Party games']),
  milestone('2027-03-27', BOTH, 'Planting the vegetable patch', ['cognitive', 'general'], 'park', 4,
    'Emma planted the carrots; Leo mostly moved soil from one place to another.', GRANDPARENTS),
  milestone('2027-04-10', L, 'Two-word phrases', ['language'], 'home', 0,
    '"Bye car", "more milk", "Emmy come".'),
  milestone('2027-04-24', E, 'Rides a balance bike', ['gross-motor'], 'park', 3,
    'Feet up for the whole length of the path.', PARK),
  milestone('2027-05-08', L, 'Kicks a ball', ['gross-motor'], 'park', 2,
    'Straight at Dad, every time.'),
  milestone('2027-05-22', E, 'Writes an E', ['fine-motor', 'academic'], 'school', 2,
    'The first letter of her name, with a few extra lines for luck.', NURSERY),
  milestone('2027-06-05', BOTH, "Weekend at Grandma and Grandpa's", ['general', 'social-emotional'], 'home', 4,
    'Pancakes, puddles and a very late bedtime.', GRANDPARENTS),
  milestone('2027-06-19', L, 'Drinks from an open cup', ['feeding', 'self-care'], 'meal', 1,
    'Mostly in, a little bit down his front.'),
  milestone('2027-07-03', E, 'Nursery sports day', ['gross-motor', 'social-emotional'], 'park', 3,
    'Second in the egg-and-spoon race, and the loudest cheering for everyone else.', NURSERY),
  milestone('2027-07-17', BOTH, 'Seaside holiday', ['general'], 'beach', 6,
    'A week of rock pools, sandcastles and ice creams.', ST_IVES, ['Rock pools', 'Sandcastle team']),
  milestone('2027-07-24', L, 'Builds his first sandcastle', ['fine-motor', 'cognitive'], 'beach', 2,
    'With a lot of help from his big sister.', ST_IVES),
  milestone('2027-08-14', E, 'Jumps into the pool', ['gross-motor'], 'beach', 2,
    "Straight into Dad's arms, again and again.", POOL),
  milestone('2027-08-28', L, 'Brushes his teeth', ['self-care', 'teething'], 'home', 1,
    'Sort of. Mostly he eats the toothpaste.'),
  milestone('2027-09-06', E, 'First day at pre-school', ['academic', 'social-emotional'], 'school', 4,
    'New jumper, new teacher, same big smile.', null, ['Ready to go', 'The school gate']),
  milestone('2027-09-18', L, 'Two today!', ['general', 'social-emotional'], 'party', 5,
    'A dinosaur cake. Emma helped blow out the candles (all of them).', null, ['The dinosaur cake']),
  milestone('2027-10-02', L, 'Sleeps in a big bed', ['sleep'], 'night', 1,
    'Rolled out once, climbed back in and slept till seven.'),
  milestone('2027-10-16', BOTH, 'Autumn leaf hunt', ['cognitive', 'general'], 'park', 4,
    'Emma counted the leaves; Leo threw them in the air.', PARK),
]

/** Generic photo names of each scene (after a milestone's own captions). */
export const CAPTIONS: Readonly<Record<Scene, readonly string[]>> = {
  park: ['At the park', 'Afternoon walk', 'Under the trees', 'Sunny afternoon', 'Playing outside', 'With Dad', 'With Mum'],
  beach: ['At the beach', 'Looking at the sea', 'By the water', 'Sandcastles', 'Sunset', 'Bucket and spade'],
  home: ['At home', 'In the living room', 'With Mum', 'With Dad', 'Cuddles', 'A quiet moment', 'Looking at the camera'],
  party: ['The party', 'With the balloons', 'With Grandma and Grandpa', 'The presents', 'The whole family', 'Smiles'],
  night: ['Sweet dreams', 'Bedtime', 'With teddy', 'Good night', 'After bath time'],
  meal: ['In the high chair', 'Yummy!', 'Hands on', 'Snack time', 'Surprised face', 'Clean plate'],
  school: ['The book bag', 'At the door', 'With the class', 'First drawing', 'Home time', 'In the playground'],
  play: ['Playing', 'With the toys', 'On the play mat', 'Colourful blocks', 'Look!', 'Playing all afternoon'],
  christmas: ['The Christmas tree', 'Christmas lights', 'With Grandma and Grandpa', 'Opening presents', 'Family time', 'Christmas dinner'],
}

export interface UserSpec {
  email: string
  name: string
  role: 'admin' | 'viewer'
  /** Their password: chosen by them, or temporary (an administrator gave it; changed at their first sign-in). */
  password: 'set' | 'temporary'
  disabled: boolean
  /** Invited this many days after Emma was born. */
  invitedAfterDays: number
  /** Last sign-in, in minutes before now (null: never signed in). */
  lastLoginMinutesAgo: number | null
}

/** The first one is the visitor: the demo is always signed in as this administrator. */
export const USERS: readonly UserSpec[] = [
  { email: 'alex@example.com', name: 'Alex Carter', role: 'admin', password: 'set', disabled: false, invitedAfterDays: 0, lastLoginMinutesAgo: 0 },
  { email: 'jamie@example.com', name: 'Jamie Carter', role: 'admin', password: 'set', disabled: false, invitedAfterDays: 1, lastLoginMinutesAgo: 60 * 26 },
  { email: 'rose@example.com', name: 'Grandma Rose', role: 'viewer', password: 'set', disabled: false, invitedAfterDays: 3, lastLoginMinutesAgo: 60 * 5 },
  { email: 'joe@example.com', name: 'Grandpa Joe', role: 'viewer', password: 'set', disabled: false, invitedAfterDays: 3, lastLoginMinutesAgo: 60 * 24 * 6 },
  { email: 'mia@example.com', name: 'Aunt Mia', role: 'viewer', password: 'temporary', disabled: false, invitedAfterDays: 540, lastLoginMinutesAgo: null },
  { email: 'ben@example.com', name: 'Uncle Ben', role: 'viewer', password: 'set', disabled: true, invitedAfterDays: 20, lastLoginMinutesAgo: 60 * 24 * 200 },
]

/** Photo sizes (landscape, portrait, square) and how often each is drawn. */
const PHOTO_SIZES: ReadonlyArray<readonly [number, number, number]> = [
  [1600, 1200, 3],
  [1500, 1000, 2],
  [1600, 900, 2],
  [1200, 1600, 3],
  [1000, 1500, 2],
  [1200, 1200, 3],
]

export interface PlannedPhoto {
  id: string
  name: string
  width: number
  height: number
  /** Seed of the painting (artwork.ts). */
  seed: number
}

export interface PlannedEvent {
  milestone: Milestone
  /** Date on the visitor's calendar. */
  date: string
  photos: PlannedPhoto[]
  /** Index of the cover photo. */
  cover: number
  /** When it was written down (`created_at`): that evening or a day or two later, never after now. */
  recordedAt: string
}

export interface PlannedChild extends ChildSpec {
  avatarId: string
}

export interface Scenario {
  today: string
  /** Whole years the reference dates moved forward (negative before the reference day). */
  yearShift: number
  children: PlannedChild[]
  events: PlannedEvent[]
}

/** Whole years from {@link REFERENCE_DAY} to `today` (both `YYYY-MM-DD`), rounded down. */
export function yearsSinceReference(today: string): number {
  const years = Number(today.slice(0, 4)) - Number(REFERENCE_DAY.slice(0, 4))
  return today.slice(5) < REFERENCE_DAY.slice(5) ? years - 1 : years
}

/** `2024-03-10T…Z` without milliseconds, like the API's timestamps. */
export function isoInstant(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function photoNames(item: Milestone, random: Random): string[] {
  const names = [...new Set([...item.captions, ...random.shuffled(CAPTIONS[item.scene])])]
  while (names.length < item.photos) names.push(`${item.title} ${names.length + 1}`)
  return names.slice(0, item.photos)
}

function recorded(date: string, random: Random, now: Date): string {
  const [year, month, day] = date.split('-').map(Number)
  const written = new Date(
    year,
    month - 1,
    day + random.choice([0, 0, 0, 1, 2]),
    random.between(19, 22),
    random.between(0, 59),
    random.between(0, 59),
  )
  return isoInstant(written > now ? now : written)
}

/** The demo as of `now` (local calendar). Every milestone draws from the generator, shown or not. */
export function buildScenario(now: Date): Scenario {
  const today = toISODate(now)
  const yearShift = yearsSinceReference(today)
  const shift = (date: string) => shiftISODate(date, { years: yearShift })
  const random = new Random(SEED)
  const sizes = PHOTO_SIZES.flatMap(([width, height, weight]) => Array.from({ length: weight }, () => [width, height] as const))

  const children = CHILDREN.map((child) => ({ ...child, birthDate: shift(child.birthDate), avatarId: random.uuid() }))
  const events: PlannedEvent[] = []
  for (const item of MILESTONES) {
    const date = shift(item.date)
    const photos = photoNames(item, random).map((name) => {
      const [width, height] = random.choice(sizes)
      return { id: random.uuid(), name, width, height, seed: random.uint32() }
    })
    const cover = photos.length > 1 && random.random() < 0.3 ? random.below(photos.length) : 0
    const recordedAt = recorded(date, random, now)
    if (date <= today) events.push({ milestone: item, date, photos, cover, recordedAt })
  }
  return { today, yearShift, children, events }
}
