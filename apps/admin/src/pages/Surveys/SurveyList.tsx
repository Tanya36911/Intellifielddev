import { useNavigate } from 'react-router-dom'
import { Button, Card, Chip, Icon } from '../../ui'
import { Topbar } from '../../shell/Topbar'
import { selectSession, useAppSelector } from '../../store'
import { surveyStats, useSurveyList, type Survey } from './useSurveys'
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
}: {
  survey: Survey
  isAdmin: boolean
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
      {isAdmin && (
        <div className={styles.rowActions}>
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
        </div>
      )}
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

  function onNew() {
    navigate('/surveys/new')
  }

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
                <SurveyRow key={s.id} survey={s} isAdmin={!!isAdmin} />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
