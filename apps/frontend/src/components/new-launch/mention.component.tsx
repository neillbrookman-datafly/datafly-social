'use client';

import React, { FC, useEffect, useImperativeHandle, useState } from 'react';
import { computePosition, flip, shift } from '@floating-ui/dom';
import { posToDOMRect, ReactRenderer } from '@tiptap/react';
import { exitSuggestion } from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';

// Debounce utility for TipTap
const debounce = <T extends any[]>(
  func: (...args: any[]) => Promise<T>,
  wait: number
) => {
  let timeout: NodeJS.Timeout;
  return (...args: any[]): Promise<T> => {
    clearTimeout(timeout);
    return new Promise((resolve) => {
      timeout = setTimeout(async () => {
        try {
          const result = await func(...args);
          resolve(result);
        } catch (error) {
          console.error('Debounced function error:', error);
          resolve([] as T);
        }
      }, wait);
    });
  };
};

const MentionList: FC = (props: any) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const selectItem = (index: number) => {
    const item = props.items[index];

    if (item) {
      props.command(item);
    }
  };

  const upHandler = () => {
    setSelectedIndex(
      (selectedIndex + props.items.length - 1) % props.items.length
    );
  };

  const downHandler = () => {
    setSelectedIndex((selectedIndex + 1) % props.items.length);
  };

  const enterHandler = () => {
    selectItem(selectedIndex);
  };

  useEffect(() => setSelectedIndex(0), [props.items]);

  useImperativeHandle(props.ref, () => ({
    onKeyDown: ({ event }: { event: any }) => {
      if (!props.items?.length) {
        return false;
      }
      if (event.key === 'ArrowUp') {
        upHandler();
        return true;
      }

      if (event.key === 'ArrowDown') {
        downHandler();
        return true;
      }

      if (event.key === 'Enter') {
        enterHandler();
        return true;
      }

      return false;
    },
  }));

  if (props?.stop) {
    return null;
  }

  const hasItems = Array.isArray(props?.items) && props.items.length > 0;

  return (
    <div
      onMouseDown={(e) => e.preventDefault()}
      className={`dropdown-menu bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto p-2 ${
        hasItems && !props?.loading ? '' : 'pointer-events-none'
      }`}
    >
      {props?.items?.none ? (
        <div className="flex items-center justify-center p-2 text-gray-500">
          We don't have autocomplete for this social media
        </div>
      ) : props?.loading ? (
        <div className="flex items-center justify-center p-2 text-gray-500">
          Loading...
        </div>
      ) : props?.items ? (
        props.items.length === 0 ? (
          <div className="p-2 text-gray-500 text-center">No results found</div>
        ) : (
          props?.items?.map((item: any, index: any) => (
            <button
              className={`flex gap-[10px] w-full p-2 text-start rounded hover:bg-gray-100 ${
                index === selectedIndex ? 'bg-blue-100' : ''
              }`}
              key={item.id || index}
              onClick={() => selectItem(index)}
            >
              <img
                src={item.image || '/no-picture.jpg'}
                alt={item.label}
                className="w-[30px] h-[30px] rounded-full object-cover"
              />
              <div className="flex-1 text-gray-800">{item.label}</div>
            </button>
          ))
        )
      ) : (
        <div className="p-2 text-gray-500 text-center">Loading...</div>
      )}
    </div>
  );
};

const updatePosition = (editor: any, element: any) => {
  if (!editor?.view || !element) {
    return;
  }

  const virtualElement = {
    getBoundingClientRect: () =>
      posToDOMRect(
        editor.view,
        editor.state.selection.from,
        editor.state.selection.to
      ),
  };

  computePosition(virtualElement, element, {
    placement: 'bottom-start',
    strategy: 'absolute',
    middleware: [shift(), flip()],
  }).then(({ x, y, strategy }) => {
    element.style.width = 'max-content';
    element.style.position = strategy;
    element.style.left = `${x}px`;
    element.style.top = `${y}px`;
    element.style.zIndex = '1000';
  });
};

// A query this many words long with nothing found is a sentence, not a name.
const GIVE_UP_WORDS = 4;

export const suggestion = (
  loadList: (
    query: string
  ) => Promise<{ image: string; label: string; id: string }[]>,
  /** Whether tagging applies right now. Read at call time — the editor that
   *  owns this is built once, so anything captured at creation goes stale. */
  canMention?: () => boolean
) => {
  // Create debounced version of loadList once
  const debouncedLoadList = debounce(loadList, 500);
  let component: any;
  // Our own key, so the dropdown can be closed properly (exitSuggestion) rather
  // than just hidden: a hidden-but-active suggestion kept a "No results found"
  // box floating over the page, where it swallowed clicks — including on
  // "Yes, close it" when closing the post, leaving the editor stuck open.
  const pluginKey = new PluginKey('mention');
  const close = (view: any) => {
    // Deferred: closing dispatches a transaction, which mustn't happen inside
    // the editor update that called us.
    setTimeout(() => {
      if (view && !view.isDestroyed) {
        exitSuggestion(view, pluginKey);
      }
    }, 0);
  };

  return {
    pluginKey,
    allow: () => (canMention ? canMention() : true),
    allowSpaces: true,
    items: async ({ query }: { query: string }) => {
      if (!query || query.length < 2) {
        component.updateProps({ loading: true, stop: true });
        return [];
      }

      try {
        component.updateProps({ loading: true, stop: false });
        const result = await debouncedLoadList(query);
        return result;
      } catch (error) {
        return [];
      }
    },

    render: () => {
      let currentQuery = '';
      let isLoadingQuery = false;
      let stopWatchingBlur: (() => void) | undefined;

      return {
        onBeforeStart: (props: any) => {
          component = new ReactRenderer(MentionList, {
            props: {
              ...props,
              loading: true,
            },
            editor: props.editor,
          });
          component.updateProps({ ...props, loading: true, stop: false });
          updatePosition(props.editor, component.element);
        },
        onStart: (props: any) => {
          currentQuery = props.query || '';
          isLoadingQuery = currentQuery.length >= 2;

          if (!props.clientRect) {
            return;
          }

          component.element.style.position = 'absolute';
          component.element.style.zIndex = '1000';

          const container =
            document.querySelector('.mantine-Paper-root') || document.body;
          container.appendChild(component.element);
          updatePosition(props.editor, component.element);
          component.updateProps({ ...props, loading: true });

          // Leaving the editor closes the dropdown. Clicking inside the
          // dropdown doesn't blur (its mousedown is prevented), so picking an
          // item still works.
          const onBlur = () => close(props.editor.view);
          props.editor.on('blur', onBlur);
          stopWatchingBlur = () => props.editor.off('blur', onBlur);
        },

        onUpdate(props: any) {
          const newQuery = props.query || '';
          const queryChanged = newQuery !== currentQuery;
          currentQuery = newQuery;

          // If query changed and is valid, we're loading until results come in
          if (queryChanged && newQuery.length >= 2) {
            isLoadingQuery = true;
          }

          // If we have results, we're no longer loading
          if (props.items && props.items.length > 0) {
            isLoadingQuery = false;
          }

          // Show loading if we have a valid query but no results yet
          const shouldShowLoading =
            isLoadingQuery &&
            newQuery.length >= 2 &&
            (!props.items || props.items.length === 0);

          component.updateProps({ ...props, loading: false, stop: false });

          // Nothing found and the "name" has run on for several words: they've
          // carried on writing, so stop following the cursor around.
          if (
            Array.isArray(props.items) &&
            props.items.length === 0 &&
            newQuery.trim().split(/\s+/).length >= GIVE_UP_WORDS
          ) {
            close(props.editor.view);
            return;
          }

          if (!props.clientRect) {
            return;
          }

          updatePosition(props.editor, component.element);
        },

        onKeyDown(props: any) {
          if (props.event.key === 'Escape') {
            close(props.view);
            return true;
          }

          const handled = component.ref?.onKeyDown(props);
          // Enter with nothing to pick is a new line: close and let it through.
          if (!handled && props.event.key === 'Enter') {
            close(props.view);
          }
          return handled;
        },

        onExit() {
          stopWatchingBlur?.();
          component.element.remove();
          component.destroy();
        },
      };
    },
  };
};
