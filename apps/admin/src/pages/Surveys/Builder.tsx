import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Topbar } from '../../shell/Topbar'
import { Button, Card, Chip, Icon } from '../../ui'
import { useSkus } from '../Catalog/useCatalog'
import { QuestionCard } from './QuestionCard'
import { PublishConfirm } from './PublishConfirm'
import {
  blankQuestion,
  mapFromBackendQuestion,
  mapToBackendQuestion,
  pickPublishedVersionId,
  useSurvey,
  useCreateSurvey,
  useUpdateVersion,
  usePublish,
  useNewVersion,
  type BuilderQuestion,
  type QType,
} from './useSurveys'
import styles from './Builder.module.css'

// The six question types available in the "Add a question" row
const ADD_TYPES: { type: QType; label: string }[] = [
  { type: 'boolean', label: 'Yes / No' },
  { type: 'number', label: 'Number' },
  { type: 'single_choice', label: 'Single choice' },
  { type: 'multi_choice', label: 'Multiple choice' },
  { type: 'photo', label: 'Photo' },
  { type: 'text', label: 'Short text' },
]

// Validate the question list before save/publish. Returns an error message or
// null when everything looks good.
function validate(name: string, questions: BuilderQuestion[]): string | null {
  if (!name.trim()) return 'The survey needs a name before saving.'
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i]
    if (!q.prompt.trim()) return `Question ${i + 1} needs a prompt.`
    if (
      (q.type === 'single_choice' || q.type === 'multi_choice') &&
      q.options.length === 0
    ) {
      return `Question ${i + 1} needs at least one option.`
    }
    if (q.perSku && q.skuIds.length === 0) {
      return `Question ${i + 1} is set to per-product but has no selected product lines.`
    }
  }
  return null
}

export default function Builder() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  // Remote data for edit mode
  const { data: surveyDetail, refetch } = useSurvey(id)

  // Catalog for QuestionCard line pickers
  const { data: skusData } = useSkus()
  const catalog = skusData?.skus ?? []

  // Local editable state (synced from server data on first load)
  const [name, setName] = useState<string>('')
  const [questions, setQuestions] = useState<BuilderQuestion[]>([])
  // Track which survey id has been loaded to detect :id changes (fix 2)
  const [loadedId, setLoadedId] = useState<string | undefined>(undefined)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Sync remote survey data into local state whenever the route id changes (fix 2)
  if (surveyDetail && loadedId !== id) {
    // Find the draft version (published_at === null), or fall back to first
    const draft = surveyDetail.versions.find((v) => v.published_at === null)
    const version = draft ?? surveyDetail.versions[0]
    setName(surveyDetail.name)
    setQuestions(version ? version.questions.map(mapFromBackendQuestion) : [])
    setLoadedId(id)
  }

  const createSurvey = useCreateSurvey()
  const updateVersion = useUpdateVersion()
  const publish = usePublish()
  const newVersion = useNewVersion()

  // The current editable version id (null when new)
  const draftVersion = surveyDetail?.versions.find((v) => v.published_at === null)
  const allPublished =
    surveyDetail &&
    surveyDetail.versions.length > 0 &&
    surveyDetail.versions.every((v) => v.published_at !== null)
  const currentVersion = draftVersion ?? surveyDetail?.versions[0]
  const versionNumber = currentVersion?.version_number ?? 1

  // Save draft (returns the resolved survey id)
  async function saveDraft(): Promise<{ surveyId: string; versionId: string } | null> {
    const err = validate(name, questions)
    if (err) { setError(err); return null }
    setError(null)
    setSaving(true)
    try {
      const mapped = questions.map((q) => mapToBackendQuestion(q))
      if (!id) {
        // New survey
        const r = await createSurvey.mutateAsync({ name, questions: mapped })
        navigate('/surveys/' + r.id + '/edit', { replace: true })
        const ver = r.versions.find((v) => v.published_at === null) ?? r.versions[0]
        return { surveyId: r.id, versionId: ver?.id ?? '' }
      } else {
        // Edit mode: if only published versions exist, create a new draft first
        let versionId = draftVersion?.id
        if (!versionId) {
          try {
            const nv = await newVersion.mutateAsync(id)
            versionId = nv.id
          } catch (e: any) {
            if (e?.status === 409) {
              const fresh = await refetch()
              const d = fresh.data?.versions.find((v) => v.published_at === null)
              versionId = d?.id
            } else {
              throw e
            }
          }
        }
        if (!versionId) return null
        await updateVersion.mutateAsync({ surveyId: id, versionId, questions: mapped })
        return { surveyId: id, versionId }
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveDraft() {
    await saveDraft()
  }

  async function handlePublish() {
    // Save first, then show the confirm modal
    const result = await saveDraft()
    if (!result) return
    setConfirmOpen(true)
  }

  async function handleConfirmPublish() {
    setConfirmOpen(false)
    setSaving(true)
    const surveyId = id ?? ''
    try {
      const published = await publish.mutateAsync(surveyId)
      // Find the newly published version using the shared helper
      const bestId = pickPublishedVersionId(published.versions)
      if (!bestId) {
        setError('Publish did not return a published version; please reload.')
        return
      }
      navigate('/surveys/' + surveyId + '/assign', {
        state: { versionId: bestId, name },
      })
    } catch (e: any) {
      if (e?.status === 409) {
        // Fix 4: await the refetch so state is settled before returning
        setError('This survey is already published; reloading.')
        await refetch()
      } else {
        setError('Publish failed. Please try again.')
      }
    } finally {
      setSaving(false)
    }
  }

  function addQuestion(type: QType) {
    setQuestions((qs) => [...qs, blankQuestion(type)])
  }

  function updateQuestion(index: number, q: BuilderQuestion) {
    setQuestions((qs) => qs.map((old, i) => (i === index ? q : old)))
  }

  function deleteQuestion(index: number) {
    setQuestions((qs) => qs.filter((_, i) => i !== index))
  }

  function dupQuestion(index: number) {
    setQuestions((qs) => {
      const copy = [...qs]
      const dup: BuilderQuestion = { ...qs[index], id: 'q' + Math.random().toString(36).slice(2, 9) }
      copy.splice(index + 1, 0, dup)
      return copy
    })
  }

  function moveQuestion(index: number, dir: -1 | 1) {
    const target = index + dir
    if (target < 0 || target >= questions.length) return
    setQuestions((qs) => {
      const copy = [...qs]
      const tmp = copy[index]
      copy[index] = copy[target]
      copy[target] = tmp
      return copy
    })
  }

  // Fix 6: removed dead `surveyName` variable; only `displaySubtitle` is used
  const displaySubtitle = name.trim() ? name : id ? (surveyDetail?.name ?? 'Loading...') : 'New survey'

  // Status chip for the version card
  const isPublished = allPublished
  const statusLabel = isPublished ? 'Published' : 'Draft'
  const statusTone = isPublished ? 'green' : 'amber'

  return (
    <>
      <Topbar title="Form Builder" subtitle={displaySubtitle} />

      <div className={styles.scroll}>
        <div className={styles.page}>
          <div className={styles.layout}>
            {/* Main editor column */}
            <div className={styles.editor}>
              {/* Amber banner: all-published survey needs a new version to edit */}
              {allPublished && (
                <div className={styles.banner}>
                  <Icon name="branch" size={15} />
                  <span>
                    Editing creates a new version. The current version is published and frozen.
                  </span>
                </div>
              )}

              {/* Fix 1: editable name only in new mode; edit mode shows a static heading
                  because the backend has no rename endpoint (updateVersion only saves questions) */}
              {id ? (
                <div className={styles.nameHeading} aria-label="Survey name">
                  {name || surveyDetail?.name || 'Loading...'}
                </div>
              ) : (
                <input
                  className={styles.nameInput}
                  placeholder="Enter survey name..."
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  aria-label="Survey name"
                />
              )}

              {/* Question count line */}
              <div className={styles.meta}>
                <Icon name="list" size={13} />
                <span>{questions.length} question{questions.length !== 1 ? 's' : ''}</span>
              </div>

              {/* Error message */}
              {error && (
                <div className={styles.errorBanner}>
                  <Icon name="alert" size={14} />
                  {error}
                </div>
              )}

              {/* Question list */}
              <div className={styles.questionList}>
                {questions.map((q, i) => (
                  <QuestionCard
                    key={q.id}
                    q={q}
                    index={i}
                    total={questions.length}
                    catalog={catalog}
                    onChange={(updated) => updateQuestion(i, updated)}
                    onDelete={() => deleteQuestion(i)}
                    onDup={() => dupQuestion(i)}
                    onMove={moveQuestion}
                  />
                ))}
              </div>

              {/* Add a question row */}
              <div className={styles.addRow}>
                <span className={styles.addLabel}>Add a question</span>
                <div className={styles.addButtons}>
                  {ADD_TYPES.map(({ type, label }) => (
                    <Button
                      key={type}
                      size="sm"
                      onClick={() => addQuestion(type)}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              </div>
            </div>

            {/* Sticky right rail */}
            <div className={styles.rail}>
              <Card className={styles.railCard}>
                <div className={styles.railActions}>
                  <Button
                    variant="primary"
                    onClick={handlePublish}
                    disabled={saving}
                    className={styles.railBtn}
                  >
                    <Icon name="send" size={14} />
                    Publish &amp; assign
                  </Button>
                  <Button
                    variant="default"
                    onClick={handleSaveDraft}
                    disabled={saving}
                    className={styles.railBtn}
                  >
                    <Icon name="check" size={14} />
                    Save draft
                  </Button>
                </div>
              </Card>

              <Card className={styles.railCard}>
                <div className={styles.versionLabel}>This version</div>
                <div className={styles.versionRow}>
                  <Chip tone={statusTone as 'green' | 'amber'}>{statusLabel}</Chip>
                  <Chip>v{versionNumber}</Chip>
                </div>
              </Card>
            </div>
          </div>
        </div>
      </div>

      <PublishConfirm
        open={confirmOpen}
        version={versionNumber}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={handleConfirmPublish}
      />
    </>
  )
}
