import { NextResponse } from "next/server";

import { z } from "zod";

import { semanticSearch } from "@/lib/search/semantic-search";

import { OmekaSearchError } from "@/lib/search/omeka-live-search";



const searchParamsSchema = z.object({

  q: z.string().max(500).optional(),

  page: z.coerce.number().int().min(1).optional(),

  perPage: z.coerce.number().int().min(1).max(50).optional(),

  type: z.string().optional(),

  collection: z.string().optional(),

  yearFrom: z.coerce.number().int().optional(),

  yearTo: z.coerce.number().int().optional(),

  decade: z.coerce.number().int().optional(),

  author: z.string().optional(),

  recipient: z.string().optional(),

  subject: z.string().optional(),

  place: z.string().optional(),

  identifier: z.string().optional(),

});



export async function GET(request: Request) {

  const { searchParams } = new URL(request.url);

  const parsed = searchParamsSchema.safeParse({

    q: searchParams.get("q") ?? undefined,

    page: searchParams.get("page") ?? undefined,

    perPage: searchParams.get("perPage") ?? undefined,

    type: searchParams.get("type") ?? undefined,

    collection: searchParams.get("collection") ?? undefined,

    yearFrom: searchParams.get("yearFrom") ?? undefined,

    yearTo: searchParams.get("yearTo") ?? undefined,

    decade: searchParams.get("decade") ?? undefined,

    author: searchParams.get("author") ?? undefined,

    recipient: searchParams.get("recipient") ?? undefined,

    subject: searchParams.get("subject") ?? undefined,

    place: searchParams.get("place") ?? undefined,

    identifier: searchParams.get("identifier") ?? undefined,

  });



  if (!parsed.success) {

    return NextResponse.json(

      { error: "Invalid search parameters." },

      { status: 400 },

    );

  }



  const hasCriteria = Boolean(

    parsed.data.q?.trim() ||

      parsed.data.type ||

      parsed.data.collection ||

      parsed.data.yearFrom !== undefined ||

      parsed.data.yearTo !== undefined ||

      parsed.data.decade !== undefined ||

      parsed.data.author ||

      parsed.data.recipient ||

      parsed.data.subject ||

      parsed.data.place ||

      parsed.data.identifier,

  );



  if (!hasCriteria) {

    return NextResponse.json(

      { error: "Provide keywords or at least one filter." },

      { status: 400 },

    );

  }



  try {

    const results = await semanticSearch({

      query: parsed.data.q,

      page: parsed.data.page,

      perPage: parsed.data.perPage,

      documentType: parsed.data.type,

      collection: parsed.data.collection,

      yearFrom: parsed.data.yearFrom,

      yearTo: parsed.data.yearTo,

      decade: parsed.data.decade,

      author: parsed.data.author,

      recipient: parsed.data.recipient,

      subject: parsed.data.subject,

      place: parsed.data.place,

      identifier: parsed.data.identifier,

    });

    return NextResponse.json(results);

  } catch (error) {

    if (error instanceof OmekaSearchError) {

      return NextResponse.json({ error: error.message }, { status: 502 });

    }

    const message =

      error instanceof Error ? error.message : "Search failed unexpectedly.";

    return NextResponse.json({ error: message }, { status: 502 });

  }

}

