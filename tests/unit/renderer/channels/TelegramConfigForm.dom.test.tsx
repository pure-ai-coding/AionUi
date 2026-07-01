/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Assistant } from '@/common/types/agent/assistantTypes';
import type { GoogleModelSelection } from '@/renderer/pages/conversation/platforms/gemini/useGoogleModelSelection';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValueOrOptions?: string | { defaultValue?: string }) => {
      if (typeof defaultValueOrOptions === 'string') return defaultValueOrOptions;
      return defaultValueOrOptions?.defaultValue ?? key;
    },
    i18n: { language: 'en-US' },
  }),
}));

vi.mock('@/renderer/pages/conversation/Preview', () => ({
  usePreviewContext: () => ({ isOpen: false }),
}));

vi.mock('@/renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: false }),
}));

vi.mock('@/renderer/utils/model/agentLogo', () => ({
  getModelDisplayLabel: ({
    selectedLabel,
    selected_value,
    fallbackLabel,
  }: {
    selectedLabel?: string;
    selected_value?: string | null;
    fallbackLabel: string;
  }) => selectedLabel || selected_value || fallbackLabel,
}));

vi.mock('@icon-park/react', () => ({
  Brain: () => <span aria-hidden='true'>brain</span>,
  Down: () => <span aria-hidden='true'>v</span>,
  CheckOne: () => <span aria-hidden='true' />,
  CloseOne: () => <span aria-hidden='true' />,
  Copy: () => <span aria-hidden='true' />,
  Delete: () => <span aria-hidden='true' />,
  Refresh: () => <span aria-hidden='true' />,
}));

vi.mock('@arco-design/web-react', async () => {
  const actual = await vi.importActual<typeof import('@arco-design/web-react')>('@arco-design/web-react');
  return {
    ...actual,
    Message: {
      success: vi.fn(),
      error: vi.fn(),
      warning: vi.fn(),
      info: vi.fn(),
    },
  };
});

const { assistantsListMock, channelMocks } = vi.hoisted(() => ({
  assistantsListMock: vi.fn(),
  channelMocks: {
    getPendingPairings: { invoke: vi.fn() },
    getAuthorizedUsers: { invoke: vi.fn() },
    getPlatformSettings: { invoke: vi.fn() },
    setAssistantSetting: { invoke: vi.fn() },
    pairingRequested: { on: vi.fn(() => () => {}) },
    userAuthorized: { on: vi.fn(() => () => {}) },
  },
}));

vi.mock('@/common/adapter/ipcBridge', () => ({
  assistants: { list: { invoke: assistantsListMock } },
  channel: channelMocks,
}));

import TelegramConfigForm from '@/renderer/components/settings/SettingsModal/contents/channels/TelegramConfigForm';

function claudeAssistant(): Assistant {
  return {
    id: 'assistant-claude',
    source: 'builtin',
    name: 'Claude Code',
    name_i18n: {},
    description_i18n: {},
    avatar: '🤖',
    enabled: true,
    sort_order: 0,
    agent_id: 'agent-claude',
    agent: { type: 'acp', source: 'builtin', acp_backend: 'claude' },
    enabled_skills: [],
    custom_skill_names: [],
    disabled_builtin_skills: [],
    context_i18n: {},
    prompts: [],
    prompts_i18n: {},
    models: [],
  } as Assistant;
}

function aionrsAssistant(): Assistant {
  return {
    id: 'assistant-aionrs',
    source: 'generated',
    name: 'Aion CLI',
    name_i18n: {},
    description_i18n: {},
    avatar: '🤖',
    enabled: true,
    sort_order: 1,
    agent_id: 'agent-aionrs',
    agent: { type: 'aionrs', source: 'internal' },
    enabled_skills: [],
    custom_skill_names: [],
    disabled_builtin_skills: [],
    context_i18n: {},
    prompts: [],
    prompts_i18n: {},
    models: [],
  } as Assistant;
}

function makeSelection(overrides: Partial<GoogleModelSelection> = {}): GoogleModelSelection {
  return {
    current_model: undefined,
    providers: [],
    formatModelLabel: () => '',
    getDisplayModelName: () => '',
    getAvailableModels: () => [],
    handleSelectModel: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('TelegramConfigForm default model selector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    channelMocks.pairingRequested.on.mockReturnValue(() => {});
    channelMocks.userAuthorized.on.mockReturnValue(() => {});
    channelMocks.getPendingPairings.invoke.mockResolvedValue([]);
    channelMocks.getAuthorizedUsers.invoke.mockResolvedValue([]);
    channelMocks.setAssistantSetting.invoke.mockResolvedValue(undefined);
  });

  it('shows the auto-follow placeholder instead of the model dropdown when a Claude Code assistant is selected', async () => {
    assistantsListMock.mockResolvedValue([claudeAssistant()]);
    channelMocks.getPlatformSettings.invoke.mockResolvedValue({
      platform: 'telegram',
      assistant: { assistant_id: 'assistant-claude' },
      default_model: null,
    });

    render(
      <TelegramConfigForm pluginStatus={null} modelSelection={makeSelection()} onStatusChange={() => {}} />
    );

    expect(
      await screen.findByText('Automatically follow the model when CLI is running')
    ).toBeInTheDocument();
  });

  it('shows the real model dropdown when an aionrs assistant is selected', async () => {
    const selection = makeSelection({
      current_model: { id: 'openai', use_model: 'gpt-5.2' } as GoogleModelSelection['current_model'],
      providers: [{ id: 'openai', name: 'OpenAI', models: ['gpt-5.2'] } as never],
      formatModelLabel: () => 'GPT-5.2',
    });
    assistantsListMock.mockResolvedValue([aionrsAssistant()]);
    channelMocks.getPlatformSettings.invoke.mockResolvedValue({
      platform: 'telegram',
      assistant: { assistant_id: 'assistant-aionrs' },
      default_model: null,
    });

    render(<TelegramConfigForm pluginStatus={null} modelSelection={selection} onStatusChange={() => {}} />);

    expect(await screen.findByText('GPT-5.2')).toBeInTheDocument();
    expect(screen.queryByText('Automatically follow the model when CLI is running')).not.toBeInTheDocument();
  });

  it('switches the model selector to the placeholder after picking a Claude Code assistant from the dropdown', async () => {
    assistantsListMock.mockResolvedValue([aionrsAssistant(), claudeAssistant()]);
    channelMocks.getPlatformSettings.invoke.mockResolvedValue({
      platform: 'telegram',
      assistant: { assistant_id: 'assistant-aionrs' },
      default_model: null,
    });

    render(
      <TelegramConfigForm
        pluginStatus={null}
        modelSelection={makeSelection({
          providers: [{ id: 'openai', name: 'OpenAI', models: ['gpt-5.2'] } as never],
        })}
        onStatusChange={() => {}}
      />
    );

    await screen.findByText('Aion CLI');
    fireEvent.click(screen.getByText('Aion CLI'));
    fireEvent.click(await screen.findByText('Claude Code'));

    await waitFor(() =>
      expect(screen.getByText('Automatically follow the model when CLI is running')).toBeInTheDocument()
    );
  });
});
