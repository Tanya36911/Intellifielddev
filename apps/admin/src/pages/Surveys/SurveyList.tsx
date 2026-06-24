import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, Chip, Icon } from '../../ui'
import { Topbar } from '../../shell/Topbar'
import { selectSession, useAppSelector } from '../../store'
import { surveyStats, useSurveyList, useSurvey, type Survey } from './useSurveys'
import { useResponses, countBySurvey, responsesForSurvey, type ResponseRow } from './useResponses'
import { useSkus } from '../Catalog/useCatalog'
import { ResponsesListModal } from './ResponsesListModal'
import { ResponseDetailModal } from './ResponseDetailModal'
import styles from './SurveyList.module.css'

function StatTile({
  icon,
  value,
  label,
}: {
  icon: 'list' | 'checkCircle' | 'edit'
  value: number
  label: string
}) {
  return (
    <Card className={styles.stat}>
      <div className={styles.statIcon}>
        <Icon name={icon} size={18} />
      </div>
      <div>
        <div className={styles.statValue}>{value}</div>
        <div className={styles.statLabel}>{label}</div>
      </div>
    </Card>
  )
}

function EmptyState({ isAdmin, onAdd }: { isAdmin: boolean; onAdd: () => void }) {
  return (
    <Card className={styles.empty}>
      <div className={styles.emptyIcon}>
        <Icon name="list" size={26} />
      </div>
      <div className={styles.emptyTitle}>No surveys yet</div>
      <div className={styles.emptyHint}>Get started by creating your first survey.</div>
      {isAdmin && (
        <Button variant="primary" onClick={onAdd}>
          <Icon name="plus" size={14} /> New survey
        </Button>
      )}
    </Card>
  )
}

function statusChip(status: Survey['status']) {
  if (status === 'published') return <Chip tone="green">Published</Chip>
  if (status === 'draft') return <Chip tone="amber">Draft</Chip>
  return <Chip>Archived</Chip>
}

function SurveyRow({
  survey,
  isAdmin,
  responseCount,
  onViewResponses,
}: {
  survey: Survey
  isAdmin: boolean
  responseCount: number
  onViewResponses: (survey: Survey) => void
}) {
  const navigate = useNavigate()
  return (
    <Card className={styles.row}>
      <div className={styles.rowMain}>
        <div className={styles.rowName}>{survey.name}</div>
        <div className={styles.rowMeta}>
          {statusChip(survey.status)}
          <Chip>v{survey.latest_version}</Chip>
          {survey.assigned ? (
            <Chip tone="accent">Assigned</Chip>
          ) : (
            <span className={styles.notAssigned}>No assignment</span>
          )}
        </div>
      </div>
      <div className={styles.rowActions}>
        <Button
          size="sm"
          disabled={responseCount === 0}
          onClick={() => onViewResponses(survey)}
        >
          {responseCount} {responseCount === 1 ? 'response' : 'responses'}
        </Button>
        {isAdmin && (
          <>
            {survey.status === 'published' && (
              <>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => navigate(`/surveys/${survey.id}/assign`)}
                >
                  Assign
                </Button>
                <Button
                  size="sm"
                  onClick={() => navigate(`/surveys/${survey.id}/edit`)}
                >
                  Edit
                </Button>
              </>
            )}
            {survey.status === 'draft' && (
              <Button
                size="sm"
                onClick={() => navigate(`/surveys/${survey.id}/edit`)}
              >
                Continue editing
              </Button>
            )}
            {survey.status === 'archived' && (
              <Button size="sm" disabled>
                Edit
              </Button>
            )}
          </>
        )}
      </div>
    </Card>
  )
}

export default function SurveyList() {
  const navigate = useNavigate()
  const session = useAppSelector(selectSession)
  const isAdmin = session?.user.role === 'admin'

  const { data, isLoading } = useSurveyList()
  const surveys = data?.surveys ?? []
  const stats = surveyStats(surveys)

  const { data: responsesData } = useResponses()
  const allRows = responsesData?.responses ?? []

  const { data: skusData } = useSkus()
  const skus = skusData?.skus ?? []

  // Build the count map: each survey's response count, keyed by survey id.
  // Rows now carry survey_id directly so no version-id lookup is needed.
  const surveyIds = surveys.map((s) => s.id)
  const countMap = countBySurvey(allRows, surveyIds)

  // Modal state
  const [listModal, setListModal] = useState<Survey | null>(null)
  const [detailRowId, setDetailRowId] = useState<string | null>(null)
  const [fromList, setFromList] = useState(false)

  // For detail modal: fetch the selected survey's full detail to get questions
  const [detailSurveyId, setDetailSurveyId] = useState<string | null>(null)
  const { data: surveyDetail } = useSurvey(detailSurveyId ?? undefined)
  // Pick the questions from the version matching the open response
  const detailQuestions = (() => {
    if (!surveyDetail || !detailRowId) return []
    // Find the response row to get its version id
    const row = allRows.find((r) => r.id === detailRowId)
    if (!row) return []
    const version = surveyDetail.versions.find((v) => v.id === row.survey_version_id)
    return version?.questions ?? []
  })()

  function onViewResponses(survey: Survey) {
    setListModal(survey)
    setDetailSurveyId(survey.id)
  }

  function onOpenDetail(row: ResponseRow) {
    setDetailRowId(row.id)
    setFromList(true)
  }

  function onCloseList() {
    setListModal(null)
    setDetailRowId(null)
    setDetailSurveyId(null)
    setFromList(false)
  }

  function onCloseDetail() {
    setDetailRowId(null)
    if (!fromList) setListModal(null)
  }

  function onBack() {
    setDetailRowId(null)
    setFromList(false)
  }

  function onNew() {
    navigate('/surveys/new')
  }

  // Rows for the list modal -- filter by the survey's id directly
  const listRows = listModal
    ? responsesForSurvey(allRows, listModal.id)
    : []

  return (
    <>
      <Topbar title="Surveys">
        {isAdmin && (
          <Button size="sm" variant="primary" onClick={onNew}>
            <Icon name="plus" size={14} /> New survey
          </Button>
        )}
      </Topbar>

      <div className={styles.scroll}>
        <div className={styles.page}>
          <div className={styles.stats}>
            <StatTile icon="list" value={stats.total} label="Surveys" />
            <StatTile icon="checkCircle" value={stats.published} label="Published surveys" />
            <StatTile icon="edit" value={stats.draft} label="Drafts" />
          </div>

          {isLoading && <div className={styles.note}>Loading...</div>}

          {!isLoading && surveys.length === 0 && (
            <EmptyState isAdmin={!!isAdmin} onAdd={onNew} />
          )}

          {!isLoading && surveys.length > 0 && (
            <div className={styles.list}>
              {surveys.map((s) => (
                <SurveyRow
                  key={s.id}
                  survey={s}
                  isAdmin={!!isAdmin}
                  responseCount={countMap[s.id] ?? 0}
                  onViewResponses={onViewResponses}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {listModal && (
        <ResponsesListModal
          open={!!listModal && !detailRowId}
          survey={listModal}
          rows={listRows}
          onClose={onCloseList}
          onOpenDetail={onOpenDetail}
        />
      )}

      <ResponseDetailModal
        open={!!detailRowId}
        responseId={detailRowId}
        questions={detailQuestions}
        skus={skus}
        onClose={onCloseDetail}
        onBack={fromList ? onBack : undefined}
      />
    </>
  )
}
