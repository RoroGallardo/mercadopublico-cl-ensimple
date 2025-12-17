import fs from 'fs/promises'
import path from 'path'

const PROCESSED_DIR = path.resolve('data/processed')
const BADGES_DIR = path.resolve('badges')

async function getLatestOpportunities() {
  const files = await fs.readdir(PROCESSED_DIR)
  const target = files
    .filter(f => f.startsWith('opportunities-'))
    .sort()
    .reverse()[0]

  if (!target) throw new Error('No opportunities')

  return JSON.parse(
    await fs.readFile(path.join(PROCESSED_DIR, target), 'utf-8')
  )
}

async function main() {
  const data = await getLatestOpportunities()

  await fs.mkdir(BADGES_DIR, { recursive: true })

  for (const industry of ['tecnologia', 'mineria', 'iot']) {
    const count = data[industry]?.length ?? 0

    const badge = {
      schemaVersion: 1,
      label: industry,
      message: `${count} oportunidades`,
      color: count > 0 ? 'green' : 'lightgrey'
    }

    await fs.writeFile(
      path.join(BADGES_DIR, `${industry}.json`),
      JSON.stringify(badge, null, 2)
    )

    console.log(`🏷️ Badge ${industry} actualizado`)
  }
}

main().catch(console.error)
