import { useAuth, useUser } from "@clerk/react";
import { createSupabaseClient } from "./utils/supabase";
import { useEffect, useMemo, useState, useRef } from "react";

import { Show, SignInButton, SignUpButton, UserButton } from "@clerk/react";
import { BiEdit, BiTrash } from "react-icons/bi";
import { MdCancel } from "react-icons/md";

function App() {
  const [message, setMessage] = useState([]);
  const [newMessage, setNewMessage] = useState("");
  const [usersOnline, setUsersOnline] = useState([]);
  const [joinedAt, setJoinedAt] = useState(null);
  const [editMessage, setEditMessage] = useState(false);
  const [editMessageId, setEditMessageId] = useState(null);
  const [content, setContent] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [isTyping, setIsTyping] = useState(false);
  const [typingUser, setTypingUser] = useState("");

  const { getToken } = useAuth();
  const { user } = useUser();
  const supabase = useMemo(() => createSupabaseClient(getToken), [getToken]);

  const chatNowRef = useRef(null);
  const scroll = useRef();
  const typingTimeout = useRef(null);
  const channelRef = useRef(null);

  const checkUser = async () => {
    let { data } = await supabase
      .from("chat_users")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!data) {
      const { data: newUser } = await supabase
        .from("chat_users")
        .insert({
          user_id: user.id,
        })
        .select()
        .single();

      data = newUser;
    }

    return data;
  };

  const fetchMessages = async () => {
    const chatUser = await checkUser();

    const { data: users, error: usersError } = await supabase
      .from("chat_users")
      .select("*")
      .neq("user_id", user.id)
      .single();

    if (usersError) {
      console.log("not a user :", usersError);
    }

    setSelectedId(user.id !== users.user_id ? users.user_id : null);
    setJoinedAt(chatUser.created_at);

    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .gt("created_at", chatUser.created_at)
      .order("created_at", { ascending: true });

    if (!error) {
      setMessage(data);
    }
  };

  useEffect(() => {
    if (!user) return;

    fetchMessages();
  }, [user]);

  useEffect(() => {
    if (!user?.id || !selectedId) {
      return;
    }

    const channelName = [user?.id, selectedId].sort().join("-");

    const channel = supabase
      .channel(`typing-${channelName}`)
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        if (payload.userId !== user.id) {
          setIsTyping(payload.isTyping);
          setTypingUser(payload.name);
        }
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
      setSelectedId("");
    };
  }, [user?.id, selectedId, supabase]);

  const handelChange = async (e) => {
    setNewMessage(e.target.value);

    const channel = channelRef.current;

    if (!channel) {
      console.log("No typing channel");
      return;
    }

    await channel.send({
      type: "broadcast",
      event: "typing",
      payload: { userId: user.id, name: user.fullName, isTyping: true },
    });

    clearTimeout(typingTimeout.current);

    typingTimeout.current = setTimeout(async () => {
      await channel.send({
        type: "broadcast",
        event: "typing",
        payload: {
          userId: user.id,
          name: user.fullName,
          isTyping: false,
        },
      });
    }, 1000);
  };

  useEffect(() => {
    setTimeout(() => {
      if (chatNowRef.current) {
        chatNowRef.current.scrollTop = chatNowRef.current.scrollHeight;
      }
    }, 100);
  }, [message]);

  useEffect(() => {
    const channel = supabase
      .channel("message-channel")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
        },
        (payload) => {
          setMessage((perv) => {
            const exists = perv.some((m) => m.id === payload.new.id);

            if (exists) return perv;

            return [...perv, payload.new];
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
        },
        (payload) => {
          setMessage((prev) =>
            prev.map((m) => (m.id === payload.new.id ? payload.new : m)),
          );
        },
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "messages",
        },
        (payload) => {
          setMessage((prev) => prev.filter((m) => m.id !== payload.old.id));
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, joinedAt]);

  useEffect(() => {
    if (!user) return;

    const channel = supabase.channel("online-users");

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState();

        const onlineUsers = Object.keys(state);
        setUsersOnline(onlineUsers);
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({
            user: user.id,
            name: user.fullName,
          });
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, user]);

  const messageIsSeen = async (messageId) => {
    const { data, error } = await supabase
      .from("messages")
      .update({ seen_at: true })
      .eq("id", messageId)
      .is("seen_at", false)
      .select();

    console.log("Updated data :", data);
    console.log("Updated error :", error);

    // if (error) {
    //   console.log("Seen error :", error);
    // }
  };

  const handelSubmit = async (e) => {
    e.preventDefault();

    if (!newMessage.trim()) return;

    const { error } = await supabase.from("messages").insert({
      content: newMessage,
      user_id: user.id,
      name: user.fullName,
      deleted: false,
      edit: false,
    });

    if (!error) {
      setNewMessage("");
    } else {
      console.log(error);
    }
  };

  const handelUpdateMessage = async (e, id, messageId) => {
    e.preventDefault();

    if (editMessage) {
      const { errro } = await supabase
        .from("messages")
        .update({ content, edit: true })
        .eq("id", id)
        .eq("user_id", user.id);
    } else {
      const { data, error } = await supabase
        .from("messages")
        .update({ seen_at: true })
        .eq("id", messageId)
        .is("seen_at", false)
        .select();

      console.log("Seen Data :", data);
      console.log("Seen Error :", error);
    }

    if (errro) {
      console.log(error);
      return;
    }
    setEditMessage(false);
    setContent("");
    setEditMessageId(null);
  };

  useEffect(() => {
    if (!user) return;
    message.forEach((mess) => {
      if (mess.user_id !== user.id && mess.seen_at === false) {
        console.log("Seeing message :", mess.id);
        handelUpdateMessage(mess.id);
      }
    });
  }, [message, user]);

  const handelDeleteMessage = async (id) => {
    const { error } = await supabase
      .from("messages")
      .update({
        deleted: true,
        content: null,
      })
      .eq("id", id)
      .eq("user_id", user.id);

    if (error) {
      console.log(error);
      return null;
    }

    setEditMessageId(null);
  };

  const formatTime = (time) => {
    return new Date(time).toLocaleTimeString("en-IN", {
      hour12: "true",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  return (
    <>
      <div className="w-full flex h-full mt-5 justify-center items-center p-4">
        <div className="border border-gray-700 max-w-6xl w-full min-h-150 rounded-lg">
          {/* Header */}
          <div className="flex justify-between h-20 border-b border-gray-700">
            {!user ? (
              <div className="p-4 flex items-center gap-4">
                <Show when="signed-out">
                  <SignInButton />
                </Show>
                <p className="font-extralight lg:flex sm:flex md:flex hidden">
                  Please sign in to chat signed peoples.
                </p>
              </div>
            ) : (
              <div className="p-4 flex justify-between w-full">
                <div>
                  <p className="text-gray-300">Hello {user?.fullName}</p>
                  <p className="text-gray-300 italic text-sm">
                    {usersOnline.length} users online
                  </p>
                </div>
                <div className="m-2 sm:mr-4">
                  <Show when="signed-in">
                    <UserButton />
                  </Show>
                </div>
              </div>
            )}
          </div>
          {/* Main chat */}
          <div
            ref={chatNowRef}
            className="p-4 flex-col chat-bg scrollbar-none overflow-y-auto h-100 md:h-125 sm:h-125 lg:h-125"
          >
            {message?.map((mes) => (
              <div
                key={mes?.id}
                className={`w-full flex flex-col my-3 ${
                  mes?.user_id === user.id ? "items-end" : "items-start"
                }`}
              >
                <div
                  className={`${mes?.edit === true ? "flex items-center" : "flex-none"}`}
                >
                  <small className="text-[0.9rem]">{mes?.name}</small>
                  {mes.edit && mes.deleted === false && (
                    <span className="italic ml-2">edited</span>
                  )}
                </div>

                {mes.deleted ? (
                  <spna className="italic mt-1 text-gray-400">
                    This message was deleted
                  </spna>
                ) : (
                  <div
                    className={`max-w-[70%] mt-1 relative px-4 py-2 rounded-3xl wrap-break-word ${
                      mes?.user_id === user.id
                        ? "bg-blue-500 text-white rounded-tr-none"
                        : "bg-gray-700 text-white rounded-tl-none"
                    }`}
                  >
                    <p
                      className="no-select wrap-break-word whitespace-pre-wrap"
                      onClick={() => setEditMessageId(mes.id)}
                    >
                      {mes?.content}
                    </p>
                  </div>
                )}

                {mes.user_id === user.id && mes.deleted === false && (
                  <span className="text-[0.7rem] mt-1">
                    {mes.seen_at ? "Seen" : "Sent"}
                  </span>
                )}

                {user.id === mes.user_id && editMessageId === mes.id && (
                  <div className="flex text-[1.2rem] items-end gap-2">
                    <button
                      onClick={() => handelDeleteMessage(mes.id)}
                      className="border-none! mr-5! mt-2! w-0! p-0!"
                    >
                      <BiTrash />
                    </button>
                    <button
                      className="border-none! mr-5! mt-2! w-0! p-0!"
                      onClick={() => setEditMessage(true)}
                    >
                      <BiEdit width={25} height={25} />
                    </button>
                    <button
                      className="border-none! p-0! pr-0!"
                      onClick={() => {
                        setEditMessageId(null);
                      }}
                    >
                      <MdCancel onClick={() => setEditMessage(false)} />
                    </button>
                  </div>
                )}
                {editMessage && editMessageId === mes.id && (
                  <form
                    onSubmit={(e) => handelUpdateMessage(e, mes?.id)}
                    className="flex items-end flex-col gap-2 pt-2 max-w-[70%]"
                  >
                    <input
                      type="text"
                      className="border p-2 bg-[#000000] rounded-lg"
                      defaultValue={mes.content}
                      onChange={(e) => setContent(e.target.value)}
                    />
                    <button className="w-17 p-1!" type="submit">
                      Edit
                    </button>
                  </form>
                )}
                <small
                  className={`text-[0.8rem] ${mes.user_id !== user.id ? "mt-2" : "mt-0"}`}
                >
                  {formatTime(mes?.created_at)}
                </small>
              </div>
            ))}
            {/* //*{isTyping && (
              <div className="text-sm mt-4 text-gray-400">
                {typingUser} is typing...
              </div>
            )} */}
          </div>
          {/* Footer */}
          <form
            onSubmit={handelSubmit}
            className="flex flex-col sm:flex-row p-4 border-t border-gray-700"
          >
            <input
              type="text"
              onChange={handelChange}
              value={newMessage}
              disabled={!user}
              placeholder={`${user ? "Type a message..." : "Sign in to send a message"}`}
              className={`p-2 w-full focus:outline-none bg-[#000000] rounded-lg disabled:opacity-50 disabled:cursor-not-allowed`}
            />
            <button
              type="submit"
              className="mt-4 sm:mt-0 sm:ml-8 text-white max-h-12"
            >
              Sends
            </button>
            <span ref={scroll}></span>
          </form>
        </div>
      </div>
    </>
  );
}

export default App;
