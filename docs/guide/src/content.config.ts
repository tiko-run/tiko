import { defineCollection } from 'astro:content'
import { z } from 'astro/zod'
import { docsLoader } from '@astrojs/starlight/loaders'
import { docsSchema } from '@astrojs/starlight/schema'

export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    schema: docsSchema({
      // Release pages under whats-new/: the overview lists them by these fields.
      extend: z.object({
        date: z.string().optional(),
        cover: z.string().optional(),
      }),
    }),
  }),
}
