import test from "node:test";
import assert from "node:assert/strict";
import { buildHourSchedule, buildTypicalHourContext, normalizeComposerEpisodes } from "../src/schedule.js";

test("Composer episode normalization accepts nested program and airtime objects", () => {
  const rows = normalizeComposerEpisodes([{
    program: { name:"Morning Edition" },
    airtime: [{ date:"2026-09-21", start:"06:00", end:"09:00" }]
  }]);
  assert.deepEqual(rows, [{ date:"2026-09-21", start:"06:00", end:"09:00", program:"Morning Edition", genre:"" }]);
});

test("hour schedule keeps chronological buckets and groups weekday programs", () => {
  const schedule = buildHourSchedule([
    { date:"2026-09-21", start:"06:00", end:"09:00", program:"Morning Edition" },
    { date:"2026-09-22", start:"06:00", end:"09:00", program:"Morning Edition" },
    { date:"2026-09-19", start:"16:00", end:"17:00", program:"The Shuffle" }
  ]);
  assert.match(schedule.get("weekday|07"), /Morning Edition/);
  assert.match(schedule.get("weekend|16"), /The Shuffle/);
});


test("typical hour context prefers a dominant program title", () => {
  const entries=[];
  for(let day=21;day<=25;day+=1) {
    entries.push({date:`2026-09-${day}`,start:"06:00",end:"09:00",program:"Morning Edition",genre:"News"});
  }
  const context=buildTypicalHourContext(entries);
  assert.deepEqual(
    {type:context.get("weekday|08")?.type,label:context.get("weekday|08")?.label},
    {type:"program",label:"Morning Edition"}
  );
});

test("typical hour context falls back to genre when titles rotate consistently", () => {
  const entries=[
    {date:"2026-09-21",start:"20:00",end:"21:00",program:"Jazz A",genre:"Jazz"},
    {date:"2026-09-22",start:"20:00",end:"21:00",program:"Jazz B",genre:"Jazz"},
    {date:"2026-09-23",start:"20:00",end:"21:00",program:"Jazz C",genre:"Jazz"},
    {date:"2026-09-24",start:"20:00",end:"21:00",program:"Jazz D",genre:"Jazz"},
    {date:"2026-09-25",start:"20:00",end:"21:00",program:"Jazz E",genre:"Jazz"}
  ];
  const context=buildTypicalHourContext(entries);
  assert.deepEqual(
    {type:context.get("weekday|20")?.type,label:context.get("weekday|20")?.label},
    {type:"genre",label:"Jazz"}
  );
});

test("typical hour context stays silent for a mixed slot", () => {
  const entries=[
    {date:"2026-09-21",start:"20:00",end:"21:00",program:"News A",genre:"News"},
    {date:"2026-09-22",start:"20:00",end:"21:00",program:"Jazz B",genre:"Jazz"},
    {date:"2026-09-23",start:"20:00",end:"21:00",program:"Classical C",genre:"Classical"},
    {date:"2026-09-24",start:"20:00",end:"21:00",program:"Folk D",genre:"Folk"},
    {date:"2026-09-25",start:"20:00",end:"21:00",program:"Talk E",genre:"Talk"}
  ];
  const context=buildTypicalHourContext(entries);
  assert.equal(context.has("weekday|20"),false);
});


test("JSON-encoded Composer program metadata preserves genre context", () => {
  const rows=normalizeComposerEpisodes([{
    program:'{"name":"Jazz Night","genre":"Jazz"}',
    airtime:[{date:"2026-09-21",start:"20:00",end:"21:00"}]
  }]);
  assert.deepEqual(rows,[{date:"2026-09-21",start:"20:00",end:"21:00",program:"Jazz Night",genre:"Jazz"}]);
});

test("overnight schedule hours belong to the following day and weekpart", () => {
  const entries=[
    {date:"2026-09-18",start:"23:00",end:"02:00",program:"Overnight"},
    {date:"2026-09-25",start:"23:00",end:"02:00",program:"Overnight"},
    {date:"2026-10-02",start:"23:00",end:"02:00",program:"Overnight"},
    {date:"2026-10-09",start:"23:00",end:"02:00",program:"Overnight"}
  ];
  const schedule=buildHourSchedule(entries);
  assert.match(schedule.get("weekday|23"),/Overnight/);
  assert.match(schedule.get("weekend|00"),/Overnight/);
  assert.doesNotMatch(schedule.get("weekday|00"),/Overnight/);

  const typical=buildTypicalHourContext(entries);
  assert.equal(typical.get("weekend|00")?.label,"Overnight");
  assert.equal(typical.has("weekday|00"),false);
});

test("missing end times do not become all-day typical programs", () => {
  const rows=normalizeComposerEpisodes([
    {program:{name:"Unknown End"},airtime:[{date:"2026-09-21",start:"10:00"}]},
    {program:{name:"Unknown End"},airtime:[{date:"2026-09-22",start:"10:00"}]},
    {program:{name:"Unknown End"},airtime:[{date:"2026-09-23",start:"10:00"}]},
    {program:{name:"Unknown End"},airtime:[{date:"2026-09-24",start:"10:00"}]}
  ]);
  const typical=buildTypicalHourContext(rows);
  assert.equal(typical.size,0);
});
