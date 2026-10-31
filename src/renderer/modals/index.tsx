import NiceModal from '@ebay/nice-modal-react'
import AddSourceSheet, { ADD_SOURCE_MODAL_ID } from '@/components/sources/AddSourceSheet'
import AppStoreRating from './AppStoreRating'
import ArtifactPreview from './ArtifactPreview'
import AttachLink from './AttachLink'
import ClearSessionList from './ClearSessionList'
import ContentViewer from './ContentViewer'
import ContextOverflow from './ContextOverflow'
import EdgeOneDeploySuccess from './EdgeOneDeploySuccess'
import ExportChat from './ExportChat'
import FileParseError from './FileParseError'
import ImportChatGptArchive from './ImportChatGptArchive'
import ImportedConversationView from './ImportedConversationView'
import JsonViewer from './JsonViewer'
import MessageEdit from './MessageEdit'
import ModelEdit from './ModelEdit'
import PublishWebpageConfirm from './PublishWebpageConfirm'
import ReportContent from './ReportContent'
import RewriteSheet from './RewriteSheet'
import SessionSettings from './SessionSettings'
import ThreadNameEdit from './ThreadNameEdit'
import VideoAttachmentPreview from './VideoAttachmentPreview'
import VideoPlayer from './VideoPlayer'

NiceModal.register(ADD_SOURCE_MODAL_ID, AddSourceSheet)
NiceModal.register('rewrite', RewriteSheet)
NiceModal.register('import-chatgpt-archive', ImportChatGptArchive)
NiceModal.register('imported-conversation', ImportedConversationView)
NiceModal.register('file-parse-error', FileParseError)
NiceModal.register('content-viewer', ContentViewer)
NiceModal.register('video-player', VideoPlayer)
NiceModal.register('video-attachment-preview', VideoAttachmentPreview)
NiceModal.register('session-settings', SessionSettings)
NiceModal.register('app-store-rating', AppStoreRating)
NiceModal.register('artifact-preview', ArtifactPreview)
NiceModal.register('clear-session-list', ClearSessionList)
NiceModal.register('context-overflow', ContextOverflow)
NiceModal.register('export-chat', ExportChat)
NiceModal.register('message-edit', MessageEdit)
NiceModal.register('json-viewer', JsonViewer)
NiceModal.register('attach-link', AttachLink)
NiceModal.register('report-content', ReportContent)
NiceModal.register('model-edit', ModelEdit)
NiceModal.register('thread-name-edit', ThreadNameEdit)
NiceModal.register('edgeone-deploy-success', EdgeOneDeploySuccess)
NiceModal.register('publish-webpage-confirm', PublishWebpageConfirm)
