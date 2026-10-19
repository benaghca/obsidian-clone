// A commonplace already in progress: a person keeping a garden, a dough,
// and a reading life in the same notebook. The sentences share words on
// purpose, so the margin has something true to offer.

function at(now, daysAgo, hours, minutes) {
  const date = new Date(now);
  date.setDate(date.getDate() - daysAgo);
  date.setHours(hours, minutes, 0, 0);
  // A sentence cannot have been written later than the moment the book is opened.
  if (date.getTime() > now) date.setDate(date.getDate() - 1);
  return date.getTime();
}

function line(id, daysAgo, hours, minutes, text, ties = []) {
  return { id, daysAgo, hours, minutes, text, ties };
}

const LINES = [
  line("s01", 16, 7, 40, "The west wall holds the afternoon. I can feel it with the back of my hand an hour after the sun has gone."),
  line("s02", 16, 8, 5, "A morning with the phone in the other room has a different kind of attention."),
  line("s03", 15, 18, 20, "Yeast dies above 38°C. The dough does not forgive a hot kitchen."),
  line("s04", 15, 18, 35, "Salt is there to slow the yeast in the dough, not to season the crumb."),
  line("s05", 14, 9, 10, "Tomato skins set early. The flesh keeps drinking, and that is why a tomato splits."),
  line("s06", 14, 21, 15, "I read three pages and then went to see whether the dough had moved. It had not. I had."),
  line("s07", 13, 8, 5, "Why do the tomatoes split after rain?"),
  line("s08", 13, 8, 25, "The tomatoes split after rain when the week before was dry. The skin cannot keep up with the sudden water."),
  line("s09", 12, 7, 15, "I should water the tomatoes a little every morning, not a great deal on Saturdays."),
  line("s10", 12, 7, 30, "Blossom end rot is told as a calcium story, but the calcium was in the soil. The water was not steady enough to carry it."),
  line("s11", 11, 19, 5, "I left the dough too close to the oven light and it overproofed into a slack skin."),
  line("s12", 11, 19, 20, "The crumb I want has irregular holes, and those only come when the dough has been left alone long enough to grow fragile."),
  line("s13", 10, 8, 45, "Attention is closer to fermentation than to focus. It wants a temperature and a stretch of time with no one opening the door."),
  line("s14", 10, 9, 10, "An interruption does not cost the minute you lost. It costs the fifteen minutes of attention you need in order to return."),
  line("s15", 9, 17, 40, "Folding is not kneading. You are lending the dough some structure without knocking the air out of it."),
  line("s16", 9, 17, 55, "Why does the dough slump when I turn it out, even when it looked properly risen in the bowl?"),
  line("s17", 8, 12, 10, "Steam in the first minutes keeps the crust soft enough to spring. The skin of the loaf has to stay elastic while the inside expands."),
  line("s18", 8, 21, 30, "Copying a sentence by hand makes it mine. Highlighting it only makes it a task."),
  line("s19", 7, 8, 20, "Is the starter hungry or just cold?"),
  line("s20", 7, 19, 10, "It was cold. I moved the jar off the stone counter and by evening it had doubled.", ["s19"]),
  line("s21", 6, 9, 0, "A long fermentation overnight tastes deeper than a fast rise in a warm room. Time stands in for a lot of handling of the dough."),
  line("s22", 6, 9, 15, "The starter is ready when it smells like beer and green apple, not like glue."),
  line("s23", 6, 22, 5, "What would these notes be worth if I only returned to them when my attention was already aimed?"),
  line("s24", 5, 8, 50, "I do not remember the paragraph I read while my attention was on a timer. I remember the one I read after I gave up and sat down."),
  line("s25", 5, 18, 15, "The basil bolted the same week the tomatoes split. Both of them had been rushed."),
  line("s26", 4, 8, 10, "Mulch is a way of saying the soil does not have to hear every change in the weather."),
  line("s27", 4, 11, 40, "Green tomatoes on the sill ripen in a paper bag because the bag holds the gas they have already made."),
  line("s28", 4, 16, 25, "Autolyse is flour and water with nothing else for half an hour. The dough starts without me."),
  line("s29", 3, 10, 5, "The beans climbed the tomato stakes and I let them. Not everything has to stay where I planned."),
  line("s30", 3, 19, 30, "Evening water sits on the leaves. Morning water gets used."),
  line("s31", 2, 15, 45, "I scored the loaf too timidly and it burst at the side. A cut has to be a decision."),
  line("s32", 2, 18, 20, "Standing beside the tomatoes and deciding what to do is not the same thing as looking at them."),
  line("s33", 1, 8, 15, "Why does my attention leave every time I stop to organize the thread?"),
  line("s34", 1, 8, 40, "The commonplace was never a filing cabinet. It was a place where two sentences could sit next to each other until one of them flinched."),
  line("s35", 1, 21, 5, "The best lines in here are the ones I wrote before I knew what they were for."),
  line("s36", 0, 7, 50, "I keep writing the garden down because I do not trust myself to remember which week the rain came."),
];

export function createSample(now = Date.now()) {
  return LINES.map((entry) => {
    const created = at(now, entry.daysAgo, entry.hours, entry.minutes);
    return {
      id: entry.id,
      text: entry.text,
      created,
      updated: created,
      ties: entry.ties.slice(),
    };
  });
}
