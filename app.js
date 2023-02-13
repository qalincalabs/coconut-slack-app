// import * as dotenv from "https://esm.sh/dotenv@16.0.3"
// dotenv.config()

import { App } from "https://esm.sh/@slack/bolt@3.12.2/mod.ts"


//import pkg from '@slack/bolt';
//const { App } = pkg;


import * as graphQlRequest from "./graphQlRequest.js"

import * as createTour from "./view/createTour.js"
import * as selectTour from "./view/selectTour.js"
import * as tourRecap from "./view/tourRecap.js"
import * as newShipment from "./view/newShipment.js"

import {getSuccessMessage} from "./messageSlack/success.js"
import {getAssignMessage} from "./messageSlack/assign.js"
import {getErrorMessage} from "./messageSlack/error.js"
import {getAlreadyAssignedMessage} from "./messageSlack/alreadyAssigned.js"
import {getDeliveryMessage} from "./messageSlack/delivery.js"

const app = new App({
  name: "Coconut",
  token: Deno.env.get("SLACK_BOT_TOKEN"),
  signingSecret: Deno.env.get("SLACK_SIGNING_SECRET"),
  ignoreSelf: true,
});

app.command("/createtour", async ({ ack, payload, context }) => {
  //commande pour créer un nouveau tour (choix date, heure, nom et véhicule)
  ack();

  try {
    await app.client.views.open({
      token: context.botToken,
      channel: payload.channel_id,
      trigger_id: payload.trigger_id,
      view: await createTour.getView(payload.channel_name.slice(15)),
    });
  } catch (error) {
    console.error(error);
  }
});

app.action("assignButton", async ({ ack, body, payload, context }) => {
  //Quand on clique sur le bouton "ajouter à une tournée" (affichage de la vue du choix de la tournée)

  const id = body.actions[0].value;
  ack();
  const messageData = {
    token: context.botToken,
    ts: body.message.ts,
    channel: body.channel.id,
  };

  console.log(body.channel.id)
  
  try {
    await app.client.views.open({
      token: context.botToken,
      trigger_id: body.trigger_id,
      view: await selectTour.getView(id, messageData, body.channel.id),
    });
  } catch (error) {
    console.error(error);
  }
});

app.action("tourRecapButton", async ({ ack, body, payload, context }) => {
  //Quand on clique sur le bouton "voir le tour"
  const tourId = payload.value;
  try {
    await app.client.views.open({
      token: context.botToken,
      channel: payload.channel_id,
      trigger_id: body.trigger_id,
      view: await tourRecap.getView(tourId),
    });

    ack();
  } catch (error) {
    console.error(error);
  }
});

app.action("close", async ({ ack, body, payload, context }) => {
  try {
    await app.client.chat.delete({
      token: context.botToken,
      ts: body.message.ts,
      channel: body.channel.id,
    });
  } catch (error) {
    console.error(error);
  }
  ack();
});

//Lors d'un appui sur "etape validée" dans le channel de livraison
app.action("stepDone", async ({ ack, body, payload, context }) => {
  //Attention ! Si on clique rapidement 2 fois sur le bouton, une double checkmark peut se mettre

  //On récupère le contenu du message (avec la liste des stops)
  const bodyBlocks = body.message.blocks;
  
  const metadataArray = payload.value.split(",")
  
  const stopOrder = metadataArray[0];
  const tourId = metadataArray[1];

  //On supprime le bouton qui permettait de valider l'étape
  delete bodyBlocks[2 + parseFloat(stopOrder)].accessory
    
  //On rajoute une coche verte devant l'étape
  const text = ':white_check_mark:'+bodyBlocks[2 + parseFloat(stopOrder)].text.text
  bodyBlocks[2 + parseFloat(stopOrder)].text.text = text
  
  await app.client.chat.update({
    token: context.botToken,
    ts: body.message.ts,
    channel: body.channel.id,
    blocks: bodyBlocks 
  });
  
  graphQlRequest.setStopStatus(tourId, stopOrder)
  
  ack();
  
});

app.command("/starttour", async ({ ack, payload, context }) => {
  //commande pour démarrer une tournée
  
  const channelId = "C03QY56SQ95"
  const tourId = payload.text;
  
  try {
    const result = await app.client.chat.postMessage({
      token: context.botToken,
      channel: channelId,
      blocks: await getDeliveryMessage.getDeliveryMessage(tourId),
    });
  } catch (error) {
    console.error(error);
  }
  ack();
});


app.command("/coconut", async ({ ack, payload, context }) => {
  //commande pour rajouter une commande dans le chat slack
  try {
    const result = await app.client.chat.postMessage({
      token: context.botToken,
      channel: payload.channel_id,
      blocks: newShipment.getView(),
    });
  } catch (error) {
    console.error(error);
  }
  ack();
});

app.view("selectedTourPayback",async ({ ack, body, payload, context, view }) => {
    //vue lorsqu'on assigne un shipment à une tournée (choix effectué)
    const shipmentId = Object.keys(view["state"]["values"])[0];
    const tourName = view["state"]["values"][shipmentId]["static_select-action"]["selected_option"]["text"]["text"];
    const tourId = view["state"]["values"][shipmentId]["static_select-action"]["selected_option"]["value"];
    const messageDataArray = body.view.private_metadata.split(",");
    const tourDraftData = await graphQlRequest.insertOneTourDraft(
      tourId,
      shipmentId
    );

    await app.client.chat.update({
      token: messageDataArray[0],
      ts: messageDataArray[1],
      channel: messageDataArray[2],
      blocks: getAssignMessage.getAssignMessage(shipmentId, tourName)
    });

    ack();

    const tourDraftId = tourDraftData?.data?.data?.insertOneTourDraft?._id;
    if (tourDraftId != undefined) {
      setTimeout(async function () {
        const draftStatus = (
          await graphQlRequest.getTourDraftStatus(tourDraftId)
        ).data.data.tourDraft.validation.status;

        //Ajout avec succès
        if (draftStatus == "accepted") {
          await app.client.chat.update({
            token: messageDataArray[0],
            ts: messageDataArray[1],
            channel: messageDataArray[2],
            blocks: getSuccessMessage.getSuccessMessage(shipmentId, tourName, tourId)
          });
        }
        //echec lors de l'ajout
        else {
          await app.client.chat.update({
            token: messageDataArray[0],
            ts: messageDataArray[1],
            channel: messageDataArray[2],
            blocks: getErrorMessage.getErrorMessage(shipmentId, tourName)
          });
        }
      }, 3000);
    }
    //Si le tourDraft n'est pas créé cela signifie que le shipment existe déjà dans le tour
    else {
      await app.client.chat.update({
        token: messageDataArray[0],
        ts: messageDataArray[1],
        channel: messageDataArray[2],
        blocks: getAlreadyAssignedMessage.getAlreadyAssignedMessage(shipmentId, tourName)
      });
    }
  }
);

app.view(
  "createdTourPayback",
  async ({ ack, payload, body, view, context }) => {
    //vue quand on enregistre un nouveau tour
    const tourName =
      view["state"]["values"]["choix_nom"]["plain_text_input-action"]["value"];
    const tourDay =
      view["state"]["values"]["choix_date"]["datepicker-action"][
        "selected_date"
      ];
    const tourTime =
      view["state"]["values"]["choix_time"]["timepicker-action"][
        "selected_time"
      ];
    const tourVehicle =
      view["state"]["values"]["choix_vehicle"]["vehicleSelection-action"][
        "selected_option"
      ];
    const channelId = view.blocks[7].block_id;
    const tourData = {
      tourName,
      tourDate: `${tourDay}T${tourTime}:00Z`,
      channelId: channelId,
      tourVehicle,
    };
    await graphQlRequest.addTour(tourData);
    ack();
  }
);

(async () => {
  // Deno.env.get("PORT") || 
  await app.start(3000);
  console.log("⚡️ Bolt app is running!");
})();
