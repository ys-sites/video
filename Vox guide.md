# Vox guide

Read this whole file before you answer. It tells you how to build a Vox-style explainer: a short animated story made of vintage paper cut-outs that stack themselves up on a cream page. The picture the user attached shows the look they want. Match it.

Made by @justdodani. This is the file I used for the Hotel Belvédère explainer.

---

## 1. What a Vox explainer is

- A story, not a slideshow. One surprising fact, told in 3 to 5 beats.
- Every beat is a picture you can understand without sound: a place, a year, a change, a payoff.
- Easy graphics to follow: a map with a pin, year labels, a timeline bar, one highlight.
- The look: printed photos cut out by hand, torn white paper edges, halftone dots, faded warm inks, all on cream paper.
- Titles are ransom-note words: every word cut from a different newspaper, on its own scrap.

## 2. Before you make anything

Show me a short plan first and wait for my OK. Generating images costs credits.

1. **The story in beats.** 3 to 5 lines, each with what is on screen and the title words.
2. **The piece list.** Every cut-out you need, one line each (see section 4). Usually 10 to 14 pieces.
3. **The motion plan.** In what order the scene stacks up, and what keeps moving.

## 3. The style line

Put this sentence at the end of every piece prompt, word for word. It is what makes all pieces look like they come from the same magazine.

> Style: a cut-out from a vintage 1960s travel magazine, printed photo with visible halftone dots, slightly faded warm inks, matte paper grain, cut out by hand with a thin torn white paper border all around, a soft paper curl at one edge. Isolated object, nothing else in frame, transparent background. No text, no logos, no watermark.

Model: GPT Image 2.5 (on invideo: GPT Image 2.5 Sunburst), quality high, 2K, **transparent background**. The pieces must arrive already cut out.

If I attach a photo of a real place or object, restyle exactly that thing: keep its shape, proportions and colours, and say so in the prompt.

## 4. The pieces

Build the scene in layers, back to front. Typical set:

| Layer | Piece | Aspect | Notes |
|---|---|---|---|
| Back | Sky band | 21:9 | plain blue gradient, torn edges top and bottom |
| Back | Clouds | 21:9 | 3 or 4 separate clouds with space between them |
| Middle | Mountain or skyline strip | 21:9 | ridge line cut along the top, bottom torn straight |
| Middle | The landmark of the story | 3:2 | glacier, river, building site, whatever the story is about |
| Front | Ground strip | 21:9 | road, street, coast: the thing everything stands on |
| Hero | The subject | 3:4 | the building, person or object the story is about |
| Life | 1 to 3 movers | 3:2 or 21:9 | a bus, a train, birds, a boat: things that cross the frame |
| Facts | Map paper | 1:1 | opaque, fills a country or region outline |
| Facts | Newspaper clipping | 3:2 | a year or a number as a bold headline |

Rules for pieces:
- One object per image. Ask for "each one cut out separately with space between them" when a prompt holds several (clouds, birds).
- No brands, logos, badges or number plates. Vehicles stay generic.
- No famous likenesses (a car from a film, a real person) unless I give you the photo.

### Ransom-note titles

One image per title phrase. Swap the quoted words:

> Ransom-note collage lettering spelling exactly the words: "This" "hotel" "was" "built" "for" "a" "glacier." Each word is cut out separately from a different vintage newspaper or magazine and sits on its own small torn scrap of paper, with clear empty space between the scraps, in one row. Mix the typefaces like a Vox explainer collage: a bold black newspaper serif, a condensed grotesque sans, an elegant italic serif, white letters on a black scrap, and one word in bold red letterpress on cream paper. Scraps are slightly rotated, with torn white paper edges, aged newsprint grain and a little halftone texture. Spell every word exactly as given, nothing else. Isolated scraps, transparent background, no other text, no logos, no watermark.

Then split each title into one image per word (the scraps are separate, so each one is its own island of pixels), so the words can land one by one.

## 5. The motion

Format: 16:9, 1920 x 1080, 25 fps, about 12 seconds. Cream paper background (#EDE6D6 or similar).

- **The scene stacks itself up**, back to front: sky, clouds, mountains, the landmark, the ground, then the subject. The subject can build in parts (base, floors, roof).
- **Arrivals ease out.** Each piece slides or drops in about 40 to 80 px and settles in 0.5 to 0.8 s. Fast at the start, soft at the end. No bounce, no overshoot.
- **Something is always moving.** Clouds drift slowly, birds cross, the bus drives the road, the train crosses the bottom. The picture never freezes, even while a title holds.
- **A slow camera push** over the whole shot (about 3 to 5 % scale over the 12 seconds).
- **Titles land word by word**: each scrap drops about 50 px and fades in, roughly 0.1 s after the previous word. Hold, then the next title.
- **Facts get their own beat**: the map with a pin, a year clipping, a timeline bar that draws from one year to the next.
- **The turn of the story is a change you can see.** For the glacier: the glacier slides away and the valley is bare. Show the before, then the after.
- Pieces sit on a soft drop shadow so they read as paper on paper.

## 6. Build it where I work

Use whichever of these I have connected. Ask me if it is not clear.

### DaVinci Resolve Studio (connector)
- Build it as one Fusion composition: a Loader (or MediaIn) per piece, a Transform per piece with eased keyframes (ease out on arrival), all stacked with Merge nodes over a cream Background, one camera-push Transform on top, MediaOut at the end.
- Name every node after its piece so I can find it. Keep every move as real keyframes I can edit.
- Render a preview and tell me where it is.

### DaVinci Resolve, the free version
- External scripting is a Studio feature, so you cannot drive Resolve directly. Instead:
- Tell me the folder and the exact file names to save the pieces under (for example `C:/Vox/pieces/hotel.png`).
- Write the whole Fusion composition as a `.comp` file that loads the pieces from those paths, with the same node layout and keyframes as above.
- I import it on the Fusion page (File menu, Import Fusion Composition) and press play.

### invideo (connector)
- Generate the pieces in the invideo project, then build the scene on the invideo timeline: one layer per piece, keyframed position and scale with ease-out interpolation.
- For the title words, place the title image once per word and crop each layer to one word, then stagger them.
- Export and give me the link.

### Higgsfield (connector, /katana)
- Generate the pieces on Higgsfield with the same prompts and model.
- Use Katana to build the animation as a page and render it inside Higgsfield (1920 x 1080, 25 fps), then give me the result.

## 7. After the first version

I will ask for changes like "move the bus lower", "swap the car", "make the clouds slower", "retime the title". Change only what I ask, keep everything else exactly as it was, and show me the new version.
